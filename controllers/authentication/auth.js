require("dotenv").config();
const { v4: uuid } = require('uuid')
const bcrypt = require("bcrypt");
const licensingClientModel = require("../../config/model/licensingClient");
const licensedbModel = require("../../config/model/licensedb");
const clientModel = require("../../config/model/client");
const nodeState = require("../../config/model/nodeHeartBeat");
const jwt = require("jsonwebtoken");
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const crypto = require('crypto');
const { generateClientToken } = require("../auth");
const { convertProcessSignalToExitCode } = require("util");

const refreshToken = async (req, res) => {
    const { EMAIL } = req.body;
    if (!EMAIL) return res.json({
        "StatusCode": 400,
        "Message": "failed",
        "Data": "Email is required"
    });

    try {
        const UserDetails = await clientModel.findOne({ where: { email: EMAIL } });
        if (!UserDetails) {
            return res.json({
                "StatusCode": 400,
                "Message": "failed",
                "Data": "Invalid user email"
            });
        }

        const tokenData = await generateClientToken();
        UserDetails.set({ token: tokenData.rawToken });
        await UserDetails.save();

        return res.json({
            "StatusCode": 200,
            "Message": "success",
            "Data": {
                token: tokenData.rawToken
            }
        });
    } catch (e) {
        return res.json({
            "StatusCode": 400,
            "Message": "failed",
            "Data": e.message,
        });
    }
};

const login = async (req, res) => {
  const { EMAIL, PASSWORD } = req.body;

  if (!EMAIL || !PASSWORD) {
    return res.status(400).json({
      StatusCode: 400,
      Message: "failed",
      Data: { Message: "Incorrect email and/or password" }
    });
  }

  try {
    const UserDetails = await clientModel.findOne({
      where: { email: EMAIL }
    });

    if (!UserDetails) {
      return res.status(400).json({
        StatusCode: 400,
        Message: "failed",
        Data: "Invalid user email"
      });
    }

    const isMatch = await bcrypt.compare(PASSWORD, UserDetails.passwordHashed);

    if (!isMatch) {
      return res.status(400).json({
        StatusCode: 400,
        Message: "failed",
        Data: "Invalid user password"
      });
    }

    // ✅ FIXED PAYLOAD
    const accessToken = jwt.sign(
      {
        id: UserDetails.id,
        email: UserDetails.email
      },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "30m" }
    );

    const refreshToken = jwt.sign(
      { id: UserDetails.id },

      process.env.REFRESH_TOKEN_SECRET,

      { expiresIn: "7d" }
    );

    UserDetails.accessToken = accessToken;
    await UserDetails.save();

    UserDetails.refreshToken = refreshToken;
    await UserDetails.save();

    // Fetch nodes
    const userNodes = UserDetails.regNodes || [];
    let nodeDetails = [];

    if (userNodes.length > 0) {
      for (const node of userNodes) {
        const nodeInfo = await nodeState.findOne({
          where: { nodeId: node }
        });

        if (nodeInfo) nodeDetails.push(nodeInfo);
      }
    }

    return res.json({
      StatusCode: 200,
      Message: "success",
      userData: {
        id: UserDetails.id,
        firstName: UserDetails.firstName,
        lastName: UserDetails.lastName,
        email: UserDetails.email,
        phoneNumber: UserDetails.phoneNumber,
        fullName: UserDetails.fullName,
        token: UserDetails.token,
        accessToken // ✅ only this
      },
      nodeData: nodeDetails
    });

  } catch (e) {
    return res.status(500).json({
      StatusCode: 500,
      Message: "failed",
      Data: e.message,
    });
  }
};

const licensingLogin = async (req, res) => {
  const { EMAIL, PASSWORD } = req.body;

  if (!EMAIL || !PASSWORD) {
    return res.status(400).json({
      StatusCode: 400,
      Message: "failed",
      Data: { Message: "Incorrect email and/or password" }
    });
  }

  try {
    const UserDetails = await licensingClientModel.findOne({
      where: { email: EMAIL }
    });

    // console.log("UserDetails: ", UserDetails);

    if (!UserDetails) {
      return res.status(400).json({
        StatusCode: 400,
        Message: "failed",
        Data: "Invalid user email"
      });
    }

    const isMatch = await bcrypt.compare(PASSWORD, UserDetails.passwordHashed);

    if (!isMatch) {
      return res.status(400).json({
        StatusCode: 400,
        Message: "failed",
        Data: "Invalid user password"
      });
    }

    // ✅ FIXED PAYLOAD
    const accessToken = jwt.sign(
      {
        id: UserDetails.id,
        email: UserDetails.email
      },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "30m" }
    );

    const refreshToken = jwt.sign(
      { id: UserDetails.id },

      process.env.REFRESH_TOKEN_SECRET,

      { expiresIn: "7d" }
    );

    UserDetails.accessToken = accessToken;
    await UserDetails.save();

    UserDetails.refreshToken = refreshToken;
    await UserDetails.save();

    // Fetch licensing data
    const licensingInfo = await licensedbModel.findOne({
      where: { email: UserDetails.email }
    });

    // console.log("licensingInfo: ", licensingInfo);

    return res.json({
      StatusCode: 200,
      Message: "success",
      userData: {
        id: UserDetails.id,
        email: UserDetails.email,
        phoneNumber: UserDetails.phoneNumber,
        fullName: UserDetails.fullName,
        accessToken,
        licensingData: licensingInfo || {}
      },
    });

  } catch (e) {
    return res.status(500).json({
      StatusCode: 500,
      Message: "failed",
      Data: e.message,
    });
  }
};

const logOut = async (req, res) => {
    //const cookies = req.headers.cookie;
    const auth = req.headers['authorization'];
    const Token = auth.split(" ")[1];
    console.log(Token);
    //if (!jwtToken) {
    if (!Token) {
        console.log('app crashed at line 12: logout');
        return res.json({
          "StatusCode": 400,
          "Message": "failed",
          "Data": { 
              "Details": "No JwtToken present"
          }
      }); //res.sendStatus(401);
    }
    //const refreshToken = jwtToken;
    const authToken = Token;

    const userDetails = await clientModel.findOne({
        where: {"accessToken": authToken}
    });

    console.log(userDetails);
    if(userDetails) {
        //res.clearCookie('jwt', {httpOnly: true, secure: true, origin: process.env.BASE_URL }) //'http://localhost:4001'}); //Add in production environment = secure: true;
        //return res.sendStatus(204);
        userDetails.accessToken = '';
        await userDetails.save();

        return res.json({
          "StatusCode": 200,
          "Message": "success",
          "Data": { 
              "Message": "Done"
          }
      }); //return res.redirect('/phoneLogin.html');
    } else return res.json({
            "StatusCode": 400,
            "Message": "failed",
            "Data": { 
                "Message": "No such user"
            }
        });

    //res.redirect('/phoneLogin.html');
    };

const licensingSignUp  = async (req, res) => {
    
    console.log("started"); 
    const _firstName = req.body.FIRST_NAME;
    const _lastName = req.body.LAST_NAME;
    const _fullNameRaw = `${_firstName || ''} ${_lastName || ''}`.trim();
    const _fullName = _fullNameRaw.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    const _email = req.body.EMAIL; 
    const _phoneNumber = req.body.PHONE;
    const _password = req.body.PASSWORD;
  
    if (!_email || !_firstName || !_lastName || !_phoneNumber ||!_password) return res.json({ 
        "StatusCode": 400,
        "Message": "failed",
        "Data": "Please input all required details"
    }); //res.redirect(`${process.env.BASE_URL}/signup`);

    console.log("got to step 1");
  
    const hashedPwd = await bcrypt.hash(_password, 10);
    const UserDetails = await licensingClientModel.findOne({
      where: { email: _email }
    });
    console.log("UserDetails: ", UserDetails);
    
    if (UserDetails){
      return res.json({
        "StatusCode": 400,
        "Message": "failed",
        "Data": "User already exist"
      });
    } 

    try {
        console.log("got to step 3")
        
        const newUserSignUp = await licensingClientModel.create({
        //   'id': uuid(),
          'createdAt': new Date(),
          'lastLoginAt': new Date(),
          'updatedAt': new Date(),
          'fullName': _fullName,
          'email': _email,
          'phoneNumber': _phoneNumber,
          'passwordHashed': hashedPwd
        });

        console.log("got to step 6");
        // console.log("New client details: ", newUserSignUp);

        await newUserSignUp.save();

        delete req.body.EMAIL;
        delete req.body.PHONE;
        delete req.body.PASSWORD;
        delete req.body.FIRST_NAME;
        delete req.body.LAST_NAME;
        
        return res.json({
            "StatusCode": 200,
            "Message": newUserSignUp
        });

    } catch (e) {
        delete req.body.EMAIL;
        delete req.body.PHONE;
        delete req.body.PASSWORD;
        delete req.body.BUSINESS_NAME;
        delete req.body.FIRST_NAME;
        delete req.body.LAST_NAME;
        
        console.error("Signup error:", e);

        return res.json({
            "StatusCode": 400,
            "Message": "failed",
            "Data": { 
                "Details": e instanceof Error ? e.message : e
            }
        });
    };
    };

const signUp = async (req, res) => {
    
    console.log("started"); 
    const _firstName = req.body.FIRST_NAME;
    const _lastName = req.body.LAST_NAME;
    const _fullNameRaw = `${_firstName || ''} ${_lastName || ''}`.trim();
    const _fullName = _fullNameRaw.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    const _email = req.body.EMAIL; 
    const _phoneNumber = req.body.PHONE;
    const _password = req.body.PASSWORD;
  
    if (!_email || !_firstName || !_lastName || !_phoneNumber ||!_password) return res.json({ 
        "StatusCode": 400,
        "Message": "failed",
        "Data": "Please input all required details"
    }); //res.redirect(`${process.env.BASE_URL}/signup`);

    console.log("got to step 1");
  
    const hashedPwd = await bcrypt.hash(_password, 10);
    const UserDetails = await clientModel.findOne({
      where: { email: _email }
    });
    // console.log(UserDetails);
    
    if (UserDetails) return res.json({
        "StatusCode": 400,
        "Message": "failed",
        "Data": "User already exist"
    });

    try {
        console.log("got to step 3")
        
        // const token = crypto.randomBytes(10).toString("hex");
        const token = await generateClientToken();
        
        const newUserSignUp = await clientModel.create({
        //   'id': uuid(),
          'createdAt': new Date(),
          'lastLoginAt': new Date(),
          'updatedAt': new Date(),
          'fullName': _fullName,
          'email': _email,
          'phoneNumber': _phoneNumber,
          'passwordHashed': hashedPwd,
          'token': token.rawToken,
          'tokenPublicId': token.publicId,
          'tokenSecretHash': token.secretHash,
          'isActive': true
        });

        console.log("got to step 6");
        // console.log("New client details: ", newUserSignUp);

        await newUserSignUp.save();

        delete req.body.EMAIL;
        delete req.body.PHONE;
        delete req.body.PASSWORD;
        delete req.body.FIRST_NAME;
        delete req.body.LAST_NAME;
        
        return res.json({
            "StatusCode": 200,
            "Message": newUserSignUp
        });

    } catch (e) {
        delete req.body.EMAIL;
        delete req.body.PHONE;
        delete req.body.PASSWORD;
        delete req.body.BUSINESS_NAME;
        delete req.body.FIRST_NAME;
        delete req.body.LAST_NAME;
        
        console.error("Signup error:", e);

        return res.json({
            "StatusCode": 400,
            "Message": "failed",
            "Data": { 
                "Details": e instanceof Error ? e.message : e
            }
        });
    };
    };

// Generate a 32-byte key (store securely, e.g., in environment variables)
const ENCRYPTION_KEY = crypto.randomBytes(32); // Replace with process.env.ENCRYPTION_KEY
const IV_LENGTH = 16; // AES block size

/**
 * Encrypts text using AES-256-GCM
 * @param {string} text - Plain text to encrypt
 * @returns {object} - { iv, encryptedData, authTag }
 */
function encrypt(text) {
    if (typeof text !== 'string') throw new Error('Data must be a string');

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return {
        iv: iv.toString('hex'),
        encryptedData: encrypted,
        authTag
    };
}

/**
 * Decrypts AES-256-GCM encrypted data
 * @param {object} encryptedObj - { iv, encryptedData, authTag }
 * @returns {string} - Decrypted plain text
 */
function decrypt(encryptedObj) {
    if (!encryptedObj.iv || !encryptedObj.encryptedData || !encryptedObj.authTag) {
        throw new Error('Invalid encrypted object');
    }

    const iv = Buffer.from(encryptedObj.iv, 'hex');
    const encryptedText = encryptedObj.encryptedData;
    const authTag = Buffer.from(encryptedObj.authTag, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

module.exports = {
  login,
  logOut,
  signUp,
  refreshToken,
  licensingSignUp,
  licensingLogin
};
