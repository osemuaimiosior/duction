#!/bin/sh

set -e

# echo "⏳ Waiting for the database to be ready..."

# Load environment variables from .env if it exists
  if [ -f .env ]; then
    echo "📄 Loading environment from .env"
    # export $(grep -v '^#' .env | xargs)
    set -a
    . .env
    set +a
  fi

# Point kubectl to the mounted kubeconfig
export KUBECONFIG=$HOME/.kube/config

# Optional: test connection
kubectl cluster-info
  
# Ensure NODE_ENV is set, default to production
    NODE_ENV="${NODE_ENV:-production}"

# Only run seeds in development
    echo "Creating network cluster..."

# Create the KIND cluster and nginx ingress controller bound to :80 and :443
    # kind create cluster --name ${CLUSTER_NAME} --config kube/kind-config.yaml

sleep 1
# Create the Kube namespace
    kubectl create namespace ${NAMESPACE}

sleep 1

# # Create host persistent volumes (tied the kind-control-plane docker image lifetime)
kubectl create -f kube/pv-fabric-org0.yaml
kubectl create -f kube/pv-fabric-org1.yaml
kubectl create -f kube/pv-fabric-org2.yaml

# sleep 1 

# Create persistent volume claims binding to the host (docker) volumes
    kubectl -n ${NAMESPACE} create -f kube/pvc-fabric-org0.yaml
    kubectl -n ${NAMESPACE} create -f kube/pvc-fabric-org1.yaml
    kubectl -n ${NAMESPACE} create -f kube/pvc-fabric-org2.yaml

#apply nginx ingress
    kubectl apply -f kube/ingress-nginx-kind.yaml

# Install cert-manager to manage TLS certificates
  kubectl apply -f https://github.com/jetstack/cert-manager/releases/download/v1.6.1/cert-manager.yaml

# wait and check that all three cert-manager components are fully running and ready.
  kubectl -n cert-manager rollout status deploy/cert-manager
  kubectl -n cert-manager rollout status deploy/cert-manager-cainjector
  kubectl -n cert-manager rollout status deploy/cert-manager-webhook

# wait for nginx ingress
kubectl wait --namespace ingress-nginx \
    --for=condition=ready pod \
    --selector=app.kubernetes.io/component=controller \
    --timeout=2m

export STORAGE_CLASS="standard"

local namespaces=$(echo "$ORG0_NS $ORG1_NS $ORG2_NS" | xargs -n1 | sort -u)
  for ns in $namespaces; do
    push_fn "Creating namespace \"$ns\""
    kubectl create namespace $ns || true
    pop_fn
  done

cat kube/pvc-fabric-org0.yaml | envsubst | kubectl -n $ORG0_NS create -f - || true
cat kube/pvc-fabric-org1.yaml | envsubst | kubectl -n $ORG1_NS create -f - || true
cat kube/pvc-fabric-org2.yaml | envsubst | kubectl -n $ORG2_NS create -f - || true

kubectl -n $ORG0_NS create configmap org0-config --from-file=config/org0
kubectl -n $ORG1_NS create configmap org1-config --from-file=config/org1
kubectl -n $ORG2_NS create configmap org2-config --from-file=config/org2


# Initializing TLS certificate Issuers
kubectl -n $ORG0_NS apply -f kube/root-tls-cert-issuer.yaml
kubectl -n $ORG0_NS wait --timeout=30s --for=condition=Ready issuer/root-tls-cert-issuer
kubectl -n $ORG1_NS apply -f kube/root-tls-cert-issuer.yaml
kubectl -n $ORG1_NS wait --timeout=30s --for=condition=Ready issuer/root-tls-cert-issuer
kubectl -n $ORG2_NS apply -f kube/root-tls-cert-issuer.yaml
kubectl -n $ORG2_NS wait --timeout=30s --for=condition=Ready issuer/root-tls-cert-issuer

# Use the self-signing issuer to generate three Issuers, one for each org.
kubectl -n $ORG0_NS apply -f kube/org0/org0-tls-cert-issuer.yaml
kubectl -n $ORG1_NS apply -f kube/org1/org1-tls-cert-issuer.yaml
kubectl -n $ORG2_NS apply -f kube/org2/org2-tls-cert-issuer.yaml

kubectl -n $ORG0_NS wait --timeout=30s --for=condition=Ready issuer/org0-tls-cert-issuer
kubectl -n $ORG1_NS wait --timeout=30s --for=condition=Ready issuer/org1-tls-cert-issuer
kubectl -n $ORG2_NS wait --timeout=30s --for=condition=Ready issuer/org2-tls-cert-issuer

cat $1 | envsubst | kubectl -n $2 apply -f -

cat kube/org0/org0-ca.yaml | envsubst | kubectl -n $ORG0_NS apply -f -
cat kube/org0/org1-ca.yaml | envsubst | kubectl -n $ORG1_NS apply -f -
cat kube/org0/org1-ca.yaml | envsubst | kubectl -n $ORG2_NS apply -f -

kubectl -n $ORG0_NS rollout status deploy/org0-ca
kubectl -n $ORG1_NS rollout status deploy/org1-ca
kubectl -n $ORG2_NS rollout status deploy/org2-ca

# Determine the CA information and TLS certificate
mkdir -p ${PWD}/build/cas/org0-ca
mkdir -p ${PWD}/build/cas/org1-ca
mkdir -p ${PWD}/build/cas/org2-ca

# Read the CA's TLS certificate from the cert-manager CA secret
kubectl -n $ORG0_NS get secret org0-ca-tls-cert -o json \
    | jq -r .data.\"ca.crt\" \
    | base64 -d \
    > ${PWD}/build/cas/org0-ca/tlsca-cert.pem

kubectl -n $ORG1_NS get secret org1-ca-tls-cert -o json \
    | jq -r .data.\"ca.crt\" \
    | base64 -d \
    > ${PWD}/build/cas/org1-ca/tlsca-cert.pem

kubectl -n $ORG2_NS get secret org2-ca-tls-cert -o json \
    | jq -r .data.\"ca.crt\" \
    | base64 -d \
    > ${PWD}/build/cas/org2-ca/tlsca-cert.pem

# Enroll the root CA user
fabric-ca-client enroll \
    --url https://${RCAADMIN_USER}:${RCAADMIN_PASS}@org0-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
    --tls.certfiles ${PWD}/build/cas/org0-ca/tlsca-cert.pem \
    --mspdir ${PWD}/build/enrollments/org0/users/${RCAADMIN_USER}/msp

fabric-ca-client enroll \
    --url https://${RCAADMIN_USER}:${RCAADMIN_PASS}@org1-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
    --tls.certfiles ${PWD}/build/cas/org1-ca/tlsca-cert.pem \
    --mspdir ${PWD}/build/enrollments/org1/users/${RCAADMIN_USER}/msp

fabric-ca-client enroll \
    --url https://${RCAADMIN_USER}:${RCAADMIN_PASS}@org2-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
    --tls.certfiles ${PWD}/build/cas/org2-ca/tlsca-cert.pem \
    --mspdir ${PWD}/build/enrollments/org2/users/${RCAADMIN_USER}/msp

# Each network node needs a registration, enrollment, and MSP config.yaml
# create local MSP
    # create orderer node local MSP
     # Register the node admin

  rc=0
  fabric-ca-client  register \
    --id.name       org0-orderer1 \
    --id.secret     ordererpw \
    --id.type       orderer \
    --url           https://org0-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
    --tls.certfiles ${PWD}/build/cas/org0-ca/tlsca-cert.pem \
    --mspdir        ${PWD}/build/enrollments/org0/users/${RCAADMIN_USER}/msp \
    || rc=$? 

  if [ $rc -eq 1 ]; then
    echo "CA admin was (probably) previously registered - continuing"
  fi 

    cat <<EOF | kubectl -n org0 exec deploy/org0-ca -i -- /bin/sh

  set -x
  export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
  export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

  fabric-ca-client enroll \
    --url https://org0-orderer1:ordererpw@org0-ca \
    --csr.hosts org0-orderer \
    --mspdir /var/hyperledger/fabric/organizations/ordererOrganizations/org0.example.com/orderers/org0-orderer1.org0.example.com/msp

  # Create local MSP config.yaml
  echo "NodeOUs:
    Enable: true
    ClientOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: client
    PeerOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: peer
    AdminOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: admin
    OrdererOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: orderer" > /var/hyperledger/fabric/organizations/ordererOrganizations/org0.example.com/orderers/org0-orderer1.org0.example.com/msp/config.yaml
EOF

  fabric-ca-client  register \
    --id.name       org0-orderer2 \
    --id.secret     ordererpw \
    --id.type       orderer \
    --url           https://org0-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
    --tls.certfiles ${PWD}/build/cas/org0-ca/tlsca-cert.pem \
    --mspdir        ${PWD}/build/enrollments/org0/users/${RCAADMIN_USER}/msp \
    || rc=$? 

  if [ $rc -eq 1 ]; then
    echo "CA admin was (probably) previously registered - continuing"
  fi 

  cat <<EOF | kubectl -n org0 exec deploy/org0-ca -i -- /bin/sh

  set -x
  export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
  export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

  fabric-ca-client enroll \
    --url https://org0-orderer2:ordererpw@org0-ca \
    --csr.hosts org0-orderer \
    --mspdir /var/hyperledger/fabric/organizations/ordererOrganizations/org0.example.com/orderers/org0-orderer2.org0.example.com/msp

  # Create local MSP config.yaml
  echo "NodeOUs:
    Enable: true
    ClientOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: client
    PeerOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: peer
    AdminOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: admin
    OrdererOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: orderer" > /var/hyperledger/fabric/organizations/ordererOrganizations/org0.example.com/orderers/org0-orderer2.org0.example.com/msp/config.yaml
EOF


  fabric-ca-client  register \
    --id.name       org0-orderer3 \
    --id.secret     ordererpw \
    --id.type       orderer \
    --url           https://org0-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
    --tls.certfiles ${PWD}/build/cas/org0-ca/tlsca-cert.pem \
    --mspdir        ${PWD}/build/enrollments/org0/users/${RCAADMIN_USER}/msp \
    || rc=$? 

  if [ $rc -eq 1 ]; then
    echo "CA admin was (probably) previously registered - continuing"
  fi 

  cat <<EOF | kubectl -n org0 exec deploy/org0-ca -i -- /bin/sh

  set -x
  export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
  export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

  fabric-ca-client enroll \
    --url https://org0-orderer3:ordererpw@org0-ca \
    --csr.hosts org0-orderer \
    --mspdir /var/hyperledger/fabric/organizations/ordererOrganizations/org0.example.com/orderers/org0-orderer3.org0.example.com/msp

  # Create local MSP config.yaml
  echo "NodeOUs:
    Enable: true
    ClientOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: client
    PeerOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: peer
    AdminOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: admin
    OrdererOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: orderer" > /var/hyperledger/fabric/organizations/ordererOrganizations/org0.example.com/orderers/org0-orderer3.org0.example.com/msp/config.yaml
EOF

if  [ "${ORDERER_TYPE}" == "bft" ]; then

fabric-ca-client  register \
    --id.name       org0-orderer4 \
    --id.secret     ordererpw \
    --id.type       orderer \
    --url           https://org0-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
    --tls.certfiles ${PWD}/build/cas/org0-ca/tlsca-cert.pem \
    --mspdir        ${PWD}/build/enrollments/org0/users/${RCAADMIN_USER}/msp \
    || rc=$? 

  if [ $rc -eq 1 ]; then
    echo "CA admin was (probably) previously registered - continuing"
  fi 

  cat <<EOF | kubectl -n org0 exec deploy/org0-ca -i -- /bin/sh

  set -x
  export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
  export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

  fabric-ca-client enroll \
    --url https://org0-orderer4:ordererpw@org0-ca \
    --csr.hosts org0-orderer \
    --mspdir /var/hyperledger/fabric/organizations/ordererOrganizations/org0.example.com/orderers/org0-orderer4.org0.example.com/msp

  # Create local MSP config.yaml
  echo "NodeOUs:
    Enable: true
    ClientOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: client
    PeerOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: peer
    AdminOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: admin
    OrdererOUIdentifier:
      Certificate: cacerts/org0-ca.pem
      OrganizationalUnitIdentifier: orderer" > /var/hyperledger/fabric/organizations/ordererOrganizations/org0.example.com/orderers/org0-orderer4.org0.example.com/msp/config.yaml
EOF
  fi

rc=0
  fabric-ca-client  register \
    --id.name       org1-peer1 \
    --id.secret     peerpw \
    --id.type       peer \
    --url           https://org1-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
    --tls.certfiles ${PWD}/build/cas/org1-ca/tlsca-cert.pem \
    --mspdir        ${PWD}/build/enrollments/org1/users/${RCAADMIN_USER}/msp \
    || rc=$? 

  if [ $rc -eq 1 ]; then
    echo "CA admin was (probably) previously registered - continuing"
  fi 

    cat <<EOF | kubectl -n org1 exec deploy/org1-ca -i -- /bin/sh

  set -x
  export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
  export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

  fabric-ca-client enroll \
    --url https://org1-peer1:peerpw@org1-ca \
    --csr.hosts localhost,org1-peer,org1-peer-gateway-svc \
    --mspdir /var/hyperledger/fabric/organizations/peerOrganizations/org0.example.com/peers/org1-peer1.org1.example.com/msp

  # Create local MSP config.yaml
  echo "NodeOUs:
    Enable: true
    ClientOUIdentifier:
      Certificate: cacerts/org1-ca.pem
      OrganizationalUnitIdentifier: client
    PeerOUIdentifier:
      Certificate: cacerts/org1-ca.pem
      OrganizationalUnitIdentifier: peer
    AdminOUIdentifier:
      Certificate: cacerts/org1-ca.pem
      OrganizationalUnitIdentifier: admin
    OrdererOUIdentifier:
      Certificate: cacerts/org1-ca.pem
      OrganizationalUnitIdentifier: orderer" > /var/hyperledger/fabric/organizations/peerOrganizations/org1.example.com/peers/org1-peer1.org1.example.com/msp/config.yaml
EOF

rc=0
  fabric-ca-client  register \
    --id.name       org1-peer2 \
    --id.secret     peerpw \
    --id.type       peer \
    --url           https://org1-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
    --tls.certfiles ${PWD}/build/cas/org1-ca/tlsca-cert.pem \
    --mspdir        ${PWD}/build/enrollments/org1/users/${RCAADMIN_USER}/msp \
    || rc=$? 

  if [ $rc -eq 1 ]; then
    echo "CA admin was (probably) previously registered - continuing"
  fi 

    cat <<EOF | kubectl -n org1 exec deploy/org1-ca -i -- /bin/sh

  set -x
  export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
  export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

  fabric-ca-client enroll \
    --url https://org1-peer2:peerpw@org1-ca \
    --csr.hosts localhost,org1-peer,org1-peer-gateway-svc \
    --mspdir /var/hyperledger/fabric/organizations/peerOrganizations/org0.example.com/peers/org1-peer2.org1.example.com/msp

  # Create local MSP config.yaml
  echo "NodeOUs:
    Enable: true
    ClientOUIdentifier:
      Certificate: cacerts/org1-ca.pem
      OrganizationalUnitIdentifier: client
    PeerOUIdentifier:
      Certificate: cacerts/org1-ca.pem
      OrganizationalUnitIdentifier: peer
    AdminOUIdentifier:
      Certificate: cacerts/org1-ca.pem
      OrganizationalUnitIdentifier: admin
    OrdererOUIdentifier:
      Certificate: cacerts/org1-ca.pem
      OrganizationalUnitIdentifier: orderer" > /var/hyperledger/fabric/organizations/peerOrganizations/org1.example.com/peers/org1-peer2.org1.example.com/msp/config.yaml
EOF

rc=0
  fabric-ca-client  register \
    --id.name       org2-peer1 \
    --id.secret     peerpw \
    --id.type       peer \
    --url           https://org2-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
    --tls.certfiles ${PWD}/build/cas/org2-ca/tlsca-cert.pem \
    --mspdir        ${PWD}/build/enrollments/org2/users/${RCAADMIN_USER}/msp \
    || rc=$? 

  if [ $rc -eq 1 ]; then
    echo "CA admin was (probably) previously registered - continuing"
  fi 

    cat <<EOF | kubectl -n org2 exec deploy/org2-ca -i -- /bin/sh

  set -x
  export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
  export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

  fabric-ca-client enroll \
    --url https://org2-peer1:peerpw@org2-ca \
    --csr.hosts localhost,org2-peer,org2-peer-gateway-svc \
    --mspdir /var/hyperledger/fabric/organizations/peerOrganizations/org0.example.com/peers/org2-peer1.org2.example.com/msp

  # Create local MSP config.yaml
  echo "NodeOUs:
    Enable: true
    ClientOUIdentifier:
      Certificate: cacerts/org2-ca.pem
      OrganizationalUnitIdentifier: client
    PeerOUIdentifier:
      Certificate: cacerts/org2-ca.pem
      OrganizationalUnitIdentifier: peer
    AdminOUIdentifier:
      Certificate: cacerts/org2-ca.pem
      OrganizationalUnitIdentifier: admin
    OrdererOUIdentifier:
      Certificate: cacerts/org2-ca.pem
      OrganizationalUnitIdentifier: orderer" > /var/hyperledger/fabric/organizations/peerOrganizations/org2.example.com/peers/org2-peer1.org2.example.com/msp/config.yaml
EOF

rc=0
  fabric-ca-client  register \
    --id.name       org2-peer2 \
    --id.secret     peerpw \
    --id.type       peer \
    --url           https://org2-ca.${DOMAIN}:${NGINX_HTTPS_PORT} \
    --tls.certfiles ${PWD}/build/cas/org2-ca/tlsca-cert.pem \
    --mspdir        ${PWD}/build/enrollments/org2/users/${RCAADMIN_USER}/msp \
    || rc=$? 

  if [ $rc -eq 1 ]; then
    echo "CA admin was (probably) previously registered - continuing"
  fi 

    cat <<EOF | kubectl -n org2 exec deploy/org2-ca -i -- /bin/sh

  set -x
  export FABRIC_CA_CLIENT_HOME=/var/hyperledger/fabric-ca-client
  export FABRIC_CA_CLIENT_TLS_CERTFILES=/var/hyperledger/fabric/config/tls/ca.crt

  fabric-ca-client enroll \
    --url https://org2-peer2:peerpw@org2-ca \
    --csr.hosts localhost,org2-peer,org2-peer-gateway-svc \
    --mspdir /var/hyperledger/fabric/organizations/peerOrganizations/org0.example.com/peers/org2-peer2.org2.example.com/msp

  # Create local MSP config.yaml
  echo "NodeOUs:
    Enable: true
    ClientOUIdentifier:
      Certificate: cacerts/org2-ca.pem
      OrganizationalUnitIdentifier: client
    PeerOUIdentifier:
      Certificate: cacerts/org2-ca.pem
      OrganizationalUnitIdentifier: peer
    AdminOUIdentifier:
      Certificate: cacerts/org2-ca.pem
      OrganizationalUnitIdentifier: admin
    OrdererOUIdentifier:
      Certificate: cacerts/org2-ca.pem
      OrganizationalUnitIdentifier: orderer" > /var/hyperledger/fabric/organizations/peerOrganizations/org2.example.com/peers/org2-peer2.org2.example.com/msp/config.yaml
EOF

# Launch orderers
cat kube/org0/org0-orderer1.yaml | envsubst
cat kube/org0/org0-orderer1.yaml | envsubst | kubectl -n org0 apply -f -

cat kube/org0/org0-orderer2.yaml | envsubst
cat kube/org0/org0-orderer2.yaml | envsubst | kubectl -n org0 apply -f -

cat kube/org0/org0-orderer3.yaml | envsubst
cat kube/org0/org0-orderer3.yaml | envsubst | kubectl -n org0 apply -f -

kubectl -n org0 rollout status deploy/org0-orderer1
kubectl -n org0 rollout status deploy/org0-orderer2
kubectl -n org0 rollout status deploy/org0-orderer3

if  [ "${ORDERER_TYPE}" == "bft" ]; then
    
    cat kube/org0/org0-orderer4.yaml | envsubst
    cat kube/org0/org0-orderer4.yaml | envsubst | kubectl -n org0 apply -f -

    kubectl -n org0 rollout status deploy/org0-orderer4
fi

# Launch peers
cat kube/org1/org1-peer1.yaml | envsubst
cat kube/org1/org1-peer1.yaml | envsubst | kubectl -n org1 apply -f -

cat kube/org1/org1-peer2.yaml | envsubst
cat kube/org1/org1-peer2.yaml | envsubst | kubectl -n org1 apply -f -

kubectl -n org1 rollout status deploy/org1-peer1
kubectl -n org1 rollout status deploy/org1-peer2

kubectl -n org2 rollout status deploy/org2-peer1
kubectl -n org2 rollout status deploy/org2-peer2


echo "🚀 Starting the app..."
exec npm start