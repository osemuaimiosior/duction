require("dotenv").config();
const { v4: uuid } = require('uuid')
const bcrypt = require("bcrypt");
const clientModel = require("../../config/model/client");
const nodeState = require("../../config/model/nodeHeartBeat");
const jwt = require("jsonwebtoken");
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const crypto = require('crypto');
const { generateClientToken } = require("../auth");
const { convertProcessSignalToExitCode } = require("util");

// const PROTO_PATH = path.join(__dirname, '..','controlPlane','apiGateway','controlpanel.proto');
// const packageDefinition = protoLoader.loadSync(
//     PROTO_PATH,
//     {keepCase: true,
//      longs: String,
//      enums: String,
//      defaults: true,
//      oneofs: true
//     });
// const protoDescriptor = grpc.loadPackageDefinition(packageDefinition).controlpanel;
// const controlPanellServerAddr = process.env.CONTROLL_PANEL_SERVER_ADDRESS;

// const GRPC_TLS_ENABLED = process.env.GRPC_TLS_ENABLED === 'true';
// const GRPC_ROOT_CERT = process.env.GRPC_ROOT_CERT || path.resolve(__dirname, '../../certs/ca.crt');
// const GRPC_AUTH_TOKEN = process.env.GRPC_AUTH_TOKEN || process.env.CONTROL_PANEL_API_TOKEN || '';
// const clientCredentials = GRPC_TLS_ENABLED
//   ? grpc.credentials.createSsl(fs.readFileSync(GRPC_ROOT_CERT))
//   : grpc.credentials.createInsecure();
// const controlPanellClient = new protoDescriptor.Controlpanel(controlPanellServerAddr, clientCredentials);

// const login = async (req, res) => {
//     const { EMAIL, PASSWORD } = req.body;
//     // console.log(EMAIL);
//     // console.log(PASSWORD);


//     if (!EMAIL || !PASSWORD) return res.json({
//         "StatusCode": 404,
//         "Message": "failed",
//         "Data": { 
//             "Message": "Incorrect email and/or password"
//         }
//     });

//     try {
//         // console.log("got to step 3");

//         const UserDetails = await clientModel.findOne({
//             where: { email: EMAIL }
//         });

//         if(!UserDetails) {
//             return res.json({
//                 "StatusCode": 400,
//                 "Message": "failed",
//                 "Data": "Invalid user email"
//             });
//         };

//         // console.log("User: ", UserDetails);
        
//         const pwd = UserDetails.passwordHashed;
//         const hashedPwd = await bcrypt.compare(PASSWORD, pwd);
//         // console.log("hashedPwd: ", hashedPwd)

//         if(!hashedPwd) return res.json({
//             "StatusCode": 400,
//             "Message": "failed",
//             "Data": "Invalid user password"
//         });

//         const newAccessToken = jwt.sign( 
//             { Name: UserDetails.id}, 
//             process.env.ACCESS_TOKEN_SECRET,
//             { expiresIn: '30m' } //30mins
//         );

//         UserDetails.set({
//             accessToken: newAccessToken,
//         });

//         await UserDetails.save()
//         // console.log(UserDetails);

//         const userNodes = UserDetails.regNodes || [];

//         let nodeDetails = [];
//         if(userNodes.length > 0) {
//             for(let node of userNodes){
//                 const nodeInfo = await nodeState.findOne({
//                     where: { nodeId: node }
//                 });

//                 if(nodeInfo) {
//                     nodeDetails.push(nodeInfo);
//                 }
//             }
//         }

//         delete req.body.EMAIL;
//         delete req.body.PASSWORD;

//         return res.json({
//             "StatusCode": 200,
//             "Message": "success",
//             "userData": {
//                 id: UserDetails.id,
//                 firstName: UserDetails.firstName,
//                 lastName: UserDetails.lastName,
//                 email: UserDetails.email,
//                 phoneNumber: UserDetails.phoneNumber,
//                 fullName: UserDetails.fullName,
//                 token: UserDetails.token,
//                 accessToken: UserDetails.accessToken
//             },
//             "nodeData": nodeDetails
//         });

//     } catch (e) {
//         return res.json({
//             "StatusCode": 400,
//             "Message": "failed",
//             "Data": e.message,
//         });
//     };
//     };


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

    UserDetails.accessToken = accessToken;
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

module.exports = {
  login,
  logOut,
  signUp,
  refreshToken
};
