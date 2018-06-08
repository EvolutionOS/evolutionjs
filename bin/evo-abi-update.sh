set -o errexit
set -o xtrace

function process() {
  docker cp docker_nodeosd_1:/contracts/${1}/${1}.abi .
  node ./evo-abi-update.js $1 $2
  mv ./$2 ../src/schema
}

process evo.token evo_token.json
process evo.system evo_system.json
