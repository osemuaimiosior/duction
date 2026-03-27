require("dotenv").config();
const { v4: uuid } = require('uuid')
const bcrypt = require("bcrypt");
const clientModel = require("../../config/model/client");
const jwt = require("jsonwebtoken");

const login = async (req, res) => {
    const { EMAIL, PASSWORD } = req.body;
    console.log(EMAIL);
    console.log(PASSWORD);


    if (!EMAIL || !PASSWORD) return res.json({
        "StatusCode": 404,
        "Message": "failed",
        "Data": { 
            "Message": "Incorrect email and/or password"
        }
    });

    try {
        console.log("got to step 3");

        const UserDetails = await clientModel.findOne({
            where: { email: EMAIL }
        });

        if(!UserDetails) {
            return res.json({
                "StatusCode": 200,
                "Message": "sucess",
                "Data": "Invalid user email"
            });
        };
        
        const pwd = UserDetails.passwordHashed;
        const hashedPwd = await bcrypt.compare(pwd, PASSWORD);

        if(!hashedPwd) return res.json({
            "StatusCode": 400,
            "Message": "failed",
            "Data": "Invalid user password"
        });

        const newAccessToken = jwt.sign( 
            { Name: UserDetails.email}, 
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: '30m' } //30mins
        );

        UserDetails.set({
            accessToken: newAccessToken,
        });

        await UserDetails.save()
        console.log(UserDetails);

        delete req.body.EMAIL;
        delete req.body.PASSWORD;


        return res.json({
            "StatusCode": 200,
            "Message": "success",
        });

    } catch (e) {
        return res.json({
            "StatusCode": 400,
            "Message": "failed",
            "Data": e.message,
        });
    };
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

    const userDetails = await otcUserModel.findOne({"otc_login_token": authToken}).exec();
    console.log(userDetails);
    if(userDetails) {
        //res.clearCookie('jwt', {httpOnly: true, secure: true, origin: process.env.BASE_URL }) //'http://localhost:4001'}); //Add in production environment = secure: true;
        //return res.sendStatus(204);
        userDetails.otc_login_token = '';
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
        
        const newUserSignUp = await clientModel.create({
        //   'id': uuid(),
          'createdAt': Date.now(),
          'lastLoginAt': Date.now(),
          'updatedAt': Date.now(),
          'fullName': _fullName,
          'email': _email,
          'phoneNumber': _phoneNumber,
          'passwordHashed': hashedPwd,
          'isActive': true
        });

        console.log("got to step 6");

        await newUserSignUp.save();

        delete req.body.EMAIL;
        delete req.body.PHONE;
        delete req.body.PASSWORD;
        delete req.body.BUSINESS_NAME;
        delete req.body.FIRST_NAME;
        delete req.body.LAST_NAME;
        
        return res.json({
            "StatusCode": 200,
            "Message": "success"
        });

    } catch (e) {
        delete req.body.EMAIL;
        delete req.body.PHONE;
        delete req.body.PASSWORD;
        delete req.body.BUSINESS_NAME;
        delete req.body.FIRST_NAME;
        delete req.body.LAST_NAME;
        
        return res.json({
            "StatusCode": 400,
            "Message": "failed",
            "Data": { 
                "Details": result
            }
        });
    };
};

module.exports = {
  login,
  logOut,
  signUp
};
