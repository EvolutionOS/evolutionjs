try {
  require("babel-polyfill");
} catch(e) {
  if(e.message.indexOf('only one instance of babel-polyfill is allowed') === -1) {
    console.error(e)
  }
}

const ecc = require('evojs-ecc')
const Fcbuffer = require('fcbuffer')
const EvoApi = require('evojs-api')
const assert = require('assert')

const Structs = require('./structs')
const AbiCache = require('./abi-cache')
const AssetCache = require('./asset-cache')
const writeApiGen = require('./write-api')
const format = require('./format')
const schema = require('./schema')
const pkg = require('../package.json')

const configDefaults = {
  broadcast: true,
  debug: false,
  sign: true
}

const Evo = (config = {}) => createEvo(
  Object.assign(
    {},
    {
      apiLog: consoleObjCallbackLog(config.verbose),
      transactionLog: consoleObjCallbackLog(config.verbose),
    },
    configDefaults,
    config
  )
)

module.exports = Evo

Object.assign(
  Evo,
  {
    version: pkg.version,
    modules: {
      format,
      api: EvoApi,
      ecc,
      json: {
        api: EvoApi.api,
        schema
      },
      Fcbuffer
    },

    /** @deprecated */
    Testnet: function (config) {
      console.error('deprecated, change Evo.Testnet(..) to just Evo(..)')
      return Evo(config)
    },

    /** @deprecated */
    Localnet: function (config) {
      console.error('deprecated, change Evo.Localnet(..) to just Evo(..)')
      return Evo(config)
    }
  }
)


function createEvo(config) {
  const network = EvoApi(config)
  config.network = network

  config.assetCache = AssetCache(network)
  config.abiCache = AbiCache(network, config)

  if(!config.chainId) {
    config.chainId = 'cf057bbfb72640471fd910bcb67639c22df9f92470936cddc1ade0e2f2e7dc4f'
  }

  checkChainId(network, config.chainId)

  if(config.mockTransactions != null) {
    if(typeof config.mockTransactions === 'string') {
      const mock = config.mockTransactions
      config.mockTransactions = () => mock
    }
    assert.equal(typeof config.mockTransactions, 'function', 'config.mockTransactions')
  }

  const {structs, types, fromBuffer, toBuffer} = Structs(config)
  const evo = mergeWriteFunctions(config, EvoApi, structs)

  Object.assign(evo, {fc: {
    structs,
    types,
    fromBuffer,
    toBuffer
  }})

  if(!config.signProvider) {
    config.signProvider = defaultSignProvider(evo, config)
  }

  return evo
}

function consoleObjCallbackLog(verbose = false) {
  return (error, result, name) => {
    if(error) {
      if(name) {
        console.error(name, 'error')
      }
      console.error(error);
    } else if(verbose) {
      if(name) {
        console.log(name, 'reply:')
      }
      console.log(JSON.stringify(result, null, 4))
    }
  }
}

/**
  Merge in write functions (operations).  Tested against existing methods for
  name conflicts.

  @arg {object} config.network - read-only api calls
  @arg {object} EvoApi - api[EvoApi] read-only api calls
  @return {object} - read and write method calls (create and sign transactions)
  @throw {TypeError} if a funciton name conflicts
*/
function mergeWriteFunctions(config, EvoApi, structs) {
  assert(config.network, 'network instance required')
  const {network} = config

  const merge = Object.assign({}, network)

  const writeApi = writeApiGen(EvoApi, network, structs, config, schema)
  throwOnDuplicate(merge, writeApi, 'Conflicting methods in EvoApi and Transaction Api')
  Object.assign(merge, writeApi)

  return merge
}

function throwOnDuplicate(o1, o2, msg) {
  for(const key in o1) {
    if(o2[key]) {
      throw new TypeError(msg + ': ' + key)
    }
  }
}

/**
  The default sign provider is designed to interact with the available public
  keys (maybe just one), the transaction, and the blockchain to figure out
  the minimum set of signing keys.

  If only one key is available, the blockchain API calls are skipped and that
  key is used to sign the transaction.
*/
const defaultSignProvider = (evo, config) => async function({sign, buf, transaction}) {
  const {keyProvider} = config

  if(!keyProvider) {
    throw new TypeError('This transaction requires a config.keyProvider for signing')
  }

  let keys = keyProvider
  if(typeof keyProvider === 'function') {
    keys = keyProvider({transaction})
  }

  // keyProvider may return keys or Promise<keys>
  keys = await Promise.resolve(keys)

  if(!Array.isArray(keys)) {
    keys = [keys]
  }

  keys = keys.map(key => {
    try {
      // normalize format (WIF => PVT_K1_base58privateKey)
      return {private: ecc.PrivateKey(key).toString()}
    } catch(e) {
      // normalize format (EvoKey => PUB_K1_base58publicKey)
      return {public: ecc.PublicKey(key).toString()}
    }
    assert(false, 'expecting public or private keys from keyProvider')
  })

  if(!keys.length) {
    throw new Error('missing key, check your keyProvider')
  }

  // simplify default signing #17
  if(keys.length === 1 && keys[0].private) {
    const pvt = keys[0].private
    return sign(buf, pvt)
  }

  const keyMap = new Map()

  // keys are either public or private keys
  for(const key of keys) {
    const isPrivate = key.private != null
    const isPublic = key.public != null

    if(isPrivate) {
      keyMap.set(ecc.privateToPublic(key.private), key.private)
    } else {
      keyMap.set(key.public, null)
    }
  }

  const pubkeys = Array.from(keyMap.keys())

  return evo.getRequiredKeys(transaction, pubkeys).then(({required_keys}) => {
    if(!required_keys.length) {
      throw new Error('missing required keys for ' + JSON.stringify(transaction))
    }

    const pvts = [], missingKeys = []

    for(let requiredKey of required_keys) {
      // normalize (EVOKey.. => PUB_K1_Key..)
      requiredKey = ecc.PublicKey(requiredKey).toString()

      const wif = keyMap.get(requiredKey)
      if(wif) {
        pvts.push(wif)
      } else {
        missingKeys.push(requiredKey)
      }
    }

    if(missingKeys.length !== 0) {
      assert(typeof keyProvider === 'function',
        'keyProvider function is needed for private key lookup')

      // const pubkeys = missingKeys.map(key => ecc.PublicKey(key).toStringLegacy())
      keyProvider({pubkeys: missingKeys})
        .forEach(pvt => { pvts.push(pvt) })
    }

    const sigs = []
    for(const pvt of pvts) {
      sigs.push(sign(buf, pvt))
    }

    return sigs
  })
}

function checkChainId(network, chainId) {
  network.getInfo({}).then(info => {
    if(info.chain_id !== chainId) {
      console.warn(
        'WARN: chainId mismatch, signatures will not match transaction authority. ' +
        `expected ${chainId} !== actual ${info.chain_id}`
      )
    }
  }).catch(error => {
    console.error(error)
  })
}
