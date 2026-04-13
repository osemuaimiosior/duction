const { ec2Client } = require("@aws-sdk/client-ec2");
const ec2_client = new ec2Client();


//Create resource of VPC deployment
ec2_client.createVpc({
  amazonProvidedIpv6CidrBlock: false,
  instanceTenancy: "default",
  cidrBlock: "10.0.0.0/24"
});
