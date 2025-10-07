const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs').promises;
const { TextDecoder } = require('node:util');


const utf8Decoder = new TextDecoder();

async function main() {
    const credentials = await fs.readFile('path/to/certificate.pem');

    const privateKeyPem = await fs.readFile('path/to/privateKey.pem');
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    const signer = signers.newPrivateKeySigner(privateKey);

    const tlsRootCert = await fs.readFile('path/to/tlsRootCertificate.pem');
    const client = new grpc.Client('gateway.example.org:1337', grpc.credentials.createSsl(tlsRootCert));

    const gateway = connect({
        identity: { mspId: 'myorg', credentials },
        signer,
        hash: hash.sha256,
        client,
    });

    try {
        const network = gateway.getNetwork('channelName');
        const contract = network.getContract('chaincodeName');

        const putResult = await contract.submitTransaction(
            'put', 
            'time', 
            new Date().toISOString()
        );
        
        // This params and fucntion name depends on the smart contract function intput params.
        // 'put': chaincode function name
        // @params => 'time': key
        // @params => new Date().toISOString(): value
       
        console.log('Put result:', utf8Decoder.decode(putResult));

        const getResult = await contract.evaluateTransaction('get', 'time');
        console.log('Get result:', utf8Decoder.decode(getResult));
    } finally {
        gateway.close();
        client.close();
    }
}

main().catch(console.error);