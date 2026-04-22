require('dotenv').config();
const jwt = require('jsonwebtoken');

// const verifyJWT = async (req, res, next) => {
//     const aT = req.headers['authorization'];
//     if(!aT) return res.json({
//         "StatusCode": 400,
//         "Message": "failed",
//         "Data": { 
//             "error": "Unauthorized access"
//         }
//     });
//     const accessToken = aT.split(" ")[1];
//     console.log(accessToken);
//     //const refreshToken = req.cookies.jwt;
//     //console.log("access token from verify " + accessToken);
//     try{
//         if(accessToken == undefined ) { //|| refreshToken == undefined) {
//             return res.json({
//                 "StatusCode": 400,
//                 "Message": "failed",
//                 "Data": { 
//                     "error": "Unauthorized access"
//                 }
//             }); //await handleRefreshToken(req, res, next);
//         } else {
//             jwt.verify(
//                 accessToken, 
//                 process.env.ACCESS_TOKEN_SECRET,
//                 (err, decoded) => {
//                     if(err) {
//                         console.log(err);
//                         console.log('app terminated at line 17: verifyJWT');
//                         return res.json({
//                             "StatusCode": 403,
//                             "Message": "failed",
//                             "Data": { 
//                                 "error": "JWT expired"
//                             }
//                         }); //res.sendStatus(403);
//                     } //invalid token
//                     //req.Name = decoded.Name;
//                     next();
//                 });
//             };
//         } catch (e) {
//             return res.json({
//                 "StatusCode": 400,
//                 "Message": "failed",
//                 "Data": { 
//                     "error": e.message
//                 }
//             });
//         };
// }

const verifyJWT = (req, res, next) => {
  const aT = req.headers['authorization'];

  if (!aT) {
    return res.status(401).json({
      StatusCode: 401,
      Message: "failed",
      Data: { error: "Unauthorized access" }
    });
  }

  const accessToken = aT.split(" ")[1];

  if (!accessToken) {
    return res.status(401).json({
      StatusCode: 401,
      Message: "failed",
      Data: { error: "No token provided" }
    });
  }

  jwt.verify(
    accessToken, 
    process.env.ACCESS_TOKEN_SECRET, 
    (err, decoded) => {
    if (err) {
      // return res.status(403).json({
      //   StatusCode: 403,
      //   Message: "failed",
      //   Data: { error: "JWT expired or invalid" }
      // });

      return res.status(403).json({
        error: "TOKEN_EXPIRED"
      });
    }

    req.user = decoded;

    next();
  });
};


module.exports = {
    verifyJWT
};
