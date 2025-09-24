#!/bin/sh
set -e  # exit immediately if a command fails

# 1. Create Kind cluster
kind create cluster --config=./kind-config.yaml --wait 60s

# 2. Install HLF operator
helm repo add kfs https://kfsoftware.github.io/hlf-helm-charts --force-update
helm install hlf-operator kfs/hlf-operator --version=1.13.0

# 3. Install krew (if not already installed)
if ! kubectl krew >/dev/null 2>&1; then
  set -x; cd "$(mktemp -d)" &&
  OS="$(uname | tr '[:upper:]' '[:lower:]')" &&
  ARCH="$(uname -m | sed -e 's/x86_64/amd64/' -e 's/\(arm\)\(64\)\?.*/\1\2/' -e 's/aarch64$/arm64/')" &&
  KREW="krew-${OS}_${ARCH}" &&
  curl -fsSLO "https://github.com/kubernetes-sigs/krew/releases/latest/download/${KREW}.tar.gz" &&
  tar zxvf "${KREW}.tar.gz" &&
  ./"${KREW}" install krew
fi
export PATH="${KREW_ROOT:-$HOME/.krew}/bin:$PATH"

kubectl krew install hlf

# 4. Install Istio
curl -L https://istio.io/downloadIstio | ISTIO_VERSION=1.23.3 sh -
kubectl create namespace istio-system || true

export ISTIO_PATH=$(echo $PWD/istio-*/bin)
export PATH="$PATH:$ISTIO_PATH"

istioctl operator init
kubectl apply -f ./src/istioOperator.yaml

# 5. Fabric images
export PEER_IMAGE=hyperledger/fabric-peer
export PEER_VERSION=3.1.0

export ORDERER_IMAGE=hyperledger/fabric-orderer
export ORDERER_VERSION=3.1.0

export CA_IMAGE=hyperledger/fabric-ca
export CA_VERSION=1.5.15

# 6. Configure Internal DNS
kubectl apply -f ./src/internalDNS.yaml

# 7. Configure StorageClass
export SC_NAME=standard 

# 8. Deploy CA
kubectl hlf ca create \
  --image=$CA_IMAGE --version=$CA_VERSION \
  --storage-class=$SC_NAME --capacity=1Gi \
  --name=org1-ca \
  --enroll-id=enroll --enroll-pw=enrollpw \
  --hosts=org1-ca.localho.st \
  --istio-port=443

kubectl wait --timeout=180s --for=condition=Running fabriccas.hlf.kungfusoftware.es --all

# 9. Check that the certification authority is deployed and works:
curl -k https://org1-ca.localho.st:443/cainfo

# 10. Register a user in the certification authority of the peer organization (Org1MSP)
    # register user in CA for peers
kubectl hlf ca register \
    --name=org1-ca --user=peer --secret=peerpw --type=peer \
    --enroll-id=enroll \
    --enroll-secret=enrollpw \
    --mspid=Org1MSP

# 11. Deploy a peer (Detailed example: org1-ca.<the name space of the entity> e.g org1-ca.default  or org1-ca.org1_marketing_dept_ns or org1-ca.org2_operations_dept_ns)
kubectl hlf peer create \
    --statedb=leveldb \
    --image=$PEER_IMAGE \
    --version=$PEER_VERSION \
    --storage-class=$SC_NAME \
    --enroll-id=peer \
    --mspid=Org1MSP \
    --enroll-pw=peerpw \
    --capacity=5Gi \
    --name=org1-peer0 \
    --ca-name=org1-ca.default \
    --hosts=peer0-org1.localho.st \
    --istio-port=443

kubectl wait --timeout=180s --for=condition=Running fabricpeers.hlf.kungfusoftware.es --all

# Check that the peer is deployed and works:
openssl s_client -connect peer0-org1.localho.st:443

# 12. Deploy an Orderer organization - To deploy an Orderer organization we have to:
    # Create a certification authority
    # Register user orderer with password ordererpw
    # Create orderer

# Create the certification authority
kubectl hlf ca create  \
    --image=$CA_IMAGE \
    --version=$CA_VERSION \
    --storage-class=$SC_NAME \
    --capacity=1Gi --name=ord-ca \
    --enroll-id=enroll \
    --enroll-pw=enrollpw \
    --hosts=ord-ca.localho.st \
    --istio-port=443

kubectl wait --timeout=180s --for=condition=Running fabriccas.hlf.kungfusoftware.es --all

# Check that the certification authority is deployed and works:
curl -vik https://ord-ca.localho.st:443/cainfo

# 13. Register user orderer
kubectl hlf ca register \
    --name=ord-ca \
    --user=orderer \
    --secret=ordererpw \
    --type=orderer \
    --enroll-id enroll \
    --enroll-secret=enrollpw \
    --mspid=OrdererMSP \
    --ca-url="https://ord-ca.localho.st:443"

# 14. Deploy orderer

kubectl hlf ordnode create --image=$ORDERER_IMAGE --version=$ORDERER_VERSION \
    --storage-class=$SC_NAME --enroll-id=orderer --mspid=OrdererMSP \
    --enroll-pw=ordererpw --capacity=2Gi --name=ord-node1 --ca-name=ord-ca.default \
    --hosts=orderer0-ord.localho.st --admin-hosts=admin-orderer0-ord.localho.st --istio-port=443


kubectl hlf ordnode create --image=$ORDERER_IMAGE --version=$ORDERER_VERSION \
    --storage-class=$SC_NAME --enroll-id=orderer --mspid=OrdererMSP \
    --enroll-pw=ordererpw --capacity=2Gi --name=ord-node2 --ca-name=ord-ca.default \
    --hosts=orderer1-ord.localho.st --admin-hosts=admin-orderer1-ord.localho.st --istio-port=443


kubectl hlf ordnode create --image=$ORDERER_IMAGE --version=$ORDERER_VERSION \
    --storage-class=$SC_NAME --enroll-id=orderer --mspid=OrdererMSP \
    --enroll-pw=ordererpw --capacity=2Gi --name=ord-node3 --ca-name=ord-ca.default \
    --hosts=orderer2-ord.localho.st --admin-hosts=admin-orderer2-ord.localho.st --istio-port=443


kubectl hlf ordnode create --image=$ORDERER_IMAGE --version=$ORDERER_VERSION \
    --storage-class=$SC_NAME --enroll-id=orderer --mspid=OrdererMSP \
    --enroll-pw=ordererpw --capacity=2Gi --name=ord-node4 --ca-name=ord-ca.default \
    --hosts=orderer3-ord.localho.st --admin-hosts=admin-orderer3-ord.localho.st --istio-port=443



kubectl wait --timeout=180s --for=condition=Running fabricorderernodes.hlf.kungfusoftware.es --all

    # Check that the orderer is running:
    kubectl get pods

    openssl s_client -connect orderer0-ord.localho.st:443
    openssl s_client -connect orderer1-ord.localho.st:443
    openssl s_client -connect orderer2-ord.localho.st:443
    openssl s_client -connect orderer3-ord.localho.st:443

# 15. Create channel - To create the channel we need to first create the wallet secret, which will contain the identities used by the operator to manage the channel

    # Register and enrolling OrdererMSP identity

        # register
        kubectl hlf ca register --name=ord-ca --user=admin --secret=adminpw \
            --type=admin --enroll-id enroll --enroll-secret=enrollpw --mspid=OrdererMSP

        # enroll

        kubectl hlf ca enroll --name=ord-ca --namespace=default \
            --user=admin --secret=adminpw --mspid OrdererMSP \
            --ca-name tlsca  --output orderermsp.yaml
            
        kubectl hlf ca enroll --name=ord-ca --namespace=default \
            --user=admin --secret=adminpw --mspid OrdererMSP \
            --ca-name ca  --output orderermspsign.yaml

    # Register and enrolling Org1MSP Orderer identity

        # register
        kubectl hlf ca register --name=org1-ca --user=admin --secret=adminpw \
            --type=admin --enroll-id enroll --enroll-secret=enrollpw --mspid=Org1MSP

        # enroll

        kubectl hlf ca enroll --name=org1-ca --namespace=default \
            --user=admin --secret=adminpw --mspid Org1MSP \
            --ca-name tlsca  --output org1msp-tlsca.yaml
    
    # Register and enrolling Org1MSP identity

        # register
        kubectl hlf ca register --name=org1-ca --namespace=default --user=admin --secret=adminpw \
            --type=admin --enroll-id enroll --enroll-secret=enrollpw --mspid=Org1MSP

        # enroll
        kubectl hlf ca enroll --name=org1-ca --namespace=default \
            --user=admin --secret=adminpw --mspid Org1MSP \
            --ca-name ca  --output org1msp.yaml

        # enroll
        kubectl hlf identity create --name org1-admin --namespace default \
            --ca-name org1-ca --ca-namespace default \
            --ca ca --mspid Org1MSP --enroll-id admin --enroll-secret adminpw

    # Create the secret
    kubectl create secret generic wallet --namespace=default \
        --from-file=org1msp.yaml=$PWD/org1msp.yaml \
        --from-file=orderermsp.yaml=$PWD/orderermsp.yaml \
        --from-file=orderermspsign.yaml=$PWD/orderermspsign.yaml

# 16. Create main channel
export PEER_ORG_SIGN_CERT=$(kubectl get fabriccas org1-ca -o=jsonpath='{.status.ca_cert}')
export PEER_ORG_TLS_CERT=$(kubectl get fabriccas org1-ca -o=jsonpath='{.status.tlsca_cert}')

export IDENT_8=$(printf "%8s" "")
export ORDERER_TLS_CERT=$(kubectl get fabriccas ord-ca -o=jsonpath='{.status.tlsca_cert}' | sed -e "s/^/${IDENT_8}/" )
export ORDERER0_TLS_CERT=$(kubectl get fabricorderernodes ord-node1 -o=jsonpath='{.status.tlsCert}' | sed -e "s/^/${IDENT_8}/" )
export ORDERER1_TLS_CERT=$(kubectl get fabricorderernodes ord-node2 -o=jsonpath='{.status.tlsCert}' | sed -e "s/^/${IDENT_8}/" )
export ORDERER2_TLS_CERT=$(kubectl get fabricorderernodes ord-node3 -o=jsonpath='{.status.tlsCert}' | sed -e "s/^/${IDENT_8}/" )
export ORDERER3_TLS_CERT=$(kubectl get fabricorderernodes ord-node4 -o=jsonpath='{.status.tlsCert}' | sed -e "s/^/${IDENT_8}/" )

kubectl apply -f ./src/mainChannel.yaml

# 17. Join peer to the channel
export IDENT_8=$(printf "%8s" "")
export ORDERER0_TLS_CERT=$(kubectl get fabricorderernodes ord-node1 -o=jsonpath='{.status.tlsCert}' | sed -e "s/^/${IDENT_8}/" )

kubectl apply -f ./src/joinPeer.yaml

# 18. Install a chaincode

    # Get connection string without users for organization Org1MSP and OrdererMSP
    kubectl hlf inspect \
        --output org1.yaml \
        -o Org1MSP \
        -o OrdererMSP

    # Register a user in the certification authority for signing
    kubectl hlf ca register \
        --name=org1-ca \
        --user=admin \
        --secret=adminpw \
        --type=admin \
        --enroll-id enroll \
        --enroll-secret=enrollpw \
        --mspid Org1MSP  
    
    # Get the certificates using the user created above
    kubectl hlf ca enroll \
        --name=org1-ca \
        --user=admin \
        --secret=adminpw \
        --mspid Org1MSP \
        --ca-name ca  \
        --output peer-org1.yaml

    # Attach the user to the connection string
    kubectl hlf utils adduser \
        --userPath=peer-org1.yaml \
        --config=org1.yaml \
        --username=admin \
        --mspid=Org1MSP

    # Create metadata file - chaincode as a service

        # remove the code.tar.gz chaincode.tgz if they exist
        rm code.tar.gz chaincode.tgz
        export CHAINCODE_NAME=asset
        export CHAINCODE_LABEL=asset
    
        # Prepare connection file
        tar cfz code.tar.gz connection.json
        tar cfz chaincode.tgz metadata.json code.tar.gz

        export PACKAGE_ID=$(kubectl hlf chaincode calculatepackageid --path=chaincode.tgz --language=node --label=$CHAINCODE_LABEL)

        echo "PACKAGE_ID=$PACKAGE_ID"

        kubectl hlf chaincode install \
            --path=./chaincode.tgz \
            --config=org1.yaml \
            --language=golang \
            --label=$CHAINCODE_LABEL \
            --user=admin \
            --peer=org1-peer0.default

    # Deploy chaincode container on cluster
    kubectl hlf externalchaincode sync \
        --image=kfsoftware/chaincode-external:latest \
        --name=$CHAINCODE_NAME \
        --namespace=default \
        --package-id=$PACKAGE_ID \
        --tls-required=false \
        --replicas=1

    # Check installed chaincodes
    kubectl hlf chaincode queryinstalled \
        --config=org1.yaml \
        --user=admin \
        --peer=org1-peer0.default

# 19. Approve chaincode
export SEQUENCE=1
export VERSION="1.0"

kubectl hlf chaincode approveformyorg \
    --config=org1.yaml \
    --user=admin \
    --peer=org1-peer0.default \
    --package-id=$PACKAGE_ID \
    --version "$VERSION" \
    --sequence "$SEQUENCE" \
    --name=asset \
    --policy="OR('Org1MSP.member')" \
    --channel=demo

    # Commit chaincode
    kubectl hlf chaincode commit \
        --config=org1.yaml \
        --user=admin \
        --mspid=Org1MSP \
        --version "$VERSION" \
        --sequence "$SEQUENCE" \
        --name=asset \
        --policy="OR('Org1MSP.member')" \
        --channel=demo

    # Invoke a transaction on the channel
    kubectl hlf chaincode invoke \
        --config=org1.yaml \
        --user=admin --peer=org1-peer0.default \
        --chaincode=asset \
        --channel=demo \
        --fcn=initLedger -a '[]'

    # Query assets in the channel
    kubectl hlf chaincode query \
        --config=org1.yaml \
        --user=admin --peer=org1-peer0.default \
        --chaincode=asset --channel=demo \
        --fcn=GetAllAssets -a '[]'

# 20. Cleanup the environment
#kubectl delete fabricorderernodes.hlf.kungfusoftware.es --all-namespaces --all
#kubectl delete fabricpeers.hlf.kungfusoftware.es --all-namespaces --all
#kubectl delete fabriccas.hlf.kungfusoftware.es --all-namespaces --all
#kubectl delete fabricchaincode.hlf.kungfusoftware.es --all-namespaces --all
#kubectl delete fabricmainchannels --all-namespaces --all
#kubectl delete fabricfollowerchannels --all-namespaces --all

# . Keep container running
tail -f /dev/null
