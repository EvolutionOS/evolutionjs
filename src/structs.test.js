/* eslint-env mocha */
const assert = require('assert')
const Fcbuffer = require('fcbuffer')
const ByteBuffer = require('bytebuffer')

const Evo = require('.')
const AssetCache = require('./asset-cache')

describe('shorthand', () => {

  it('authority', () => {
    const evo = Evo()
    const {authority} = evo.fc.structs

    const pubkey = 'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV'
    const auth = {threshold: 1, keys: [{key: pubkey, weight: 1}]}

    assert.deepEqual(authority.fromObject(pubkey), auth)
    assert.deepEqual(
      authority.fromObject(auth),
      Object.assign({}, auth, {accounts: [], waits: []})
    )
  })

  it('PublicKey sorting', () => {
    const evo = Evo()
    const {authority} = evo.fc.structs

    const pubkeys = [
      'EOS7wBGPvBgRVa4wQN2zm5CjgBF6S7tP7R3JavtSa2unHUoVQGhey',
      'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV'
    ]

    const authSorted = {threshold: 1, keys: [
      {key: pubkeys[1], weight: 1},
      {key: pubkeys[0], weight: 1}
    ], accounts: [], waits: []}

    const authUnsorted = {threshold: 1, keys: [
      {key: pubkeys[0], weight: 1},
      {key: pubkeys[1], weight: 1}
    ], accounts: [], waits: []}

    // assert.deepEqual(authority.fromObject(pubkey), auth)
    assert.deepEqual(authority.fromObject(authUnsorted), authSorted)
  })

  it('public_key', () => {
    const evo = Evo()
    const {structs, types} = evo.fc
    const PublicKeyType = types.public_key()
    const pubkey = 'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV'
    // 02c0ded2bc1f1305fb0faac5e6c03ee3a1924234985427b6167ca569d13df435cf
    assertSerializer(PublicKeyType, pubkey)
  })

  it('symbol', () => {
    const evo = Evo()
    const {types} = evo.fc
    const Symbol = types.symbol()

    assertSerializer(Symbol, '4,SYS', '4,SYS', 'SYS')
  })

  it('extended_symbol', () => {
    const evo = Evo({defaults: true})
    const esType = evo.fc.types.extended_symbol()
    const esString = esType.toObject()
    assertSerializer(esType, esString)
  })

  it('asset', () => {
    const evo = Evo()
    const {types} = evo.fc
    const AssetType = types.asset()
    assertSerializer(AssetType, '1.1 4,SYS@evo.token', '1.1000 SYS@evo.token', '1.1000 SYS')
  })

  it('extended_asset', () => {
    const evo = Evo({defaults: true})
    const eaType = evo.fc.types.extended_asset()
    const eaString = eaType.toObject()
    assertSerializer(eaType, eaString)
  })

  it('signature', () => {
    const evo = Evo()
    const {types} = evo.fc
    const SignatureType = types.signature()
    const signatureString = 'SIG_K1_JwxtqesXpPdaZB9fdoVyzmbWkd8tuX742EQfnQNexTBfqryt2nn9PomT5xwsVnUB4m7KqTgTBQKYf2FTYbhkB5c7Kk9EsH'
    //const signatureString = 'SIG_K1_Jzdpi5RCzHLGsQbpGhndXBzcFs8vT5LHAtWLMxPzBdwRHSmJkcCdVu6oqPUQn1hbGUdErHvxtdSTS1YA73BThQFwV1v4G5'
    assertSerializer(SignatureType, signatureString)
  })

})

if(process.env['NODE_ENV'] === 'development') {

  describe('Evoio Abi', () => {

    it('Evoio token contract parses', (done) => {
      const evo = Evo()

      evo.contract('evo.token', (error, evo_token) => {
        assert(!error, error)
        assert(evo_token.transfer, 'evo.token contract')
        assert(evo_token.issue, 'evo.token contract')
        done()
      })
    })

  })
}

describe('Action.data', () => {
  it('json', () => {
    const evo = Evo({forceActionDataHex: false})
    const {structs, types} = evo.fc
    const value = {
      account: 'evo.token',
      name: 'transfer',
      data: {
        from: 'inita',
        to: 'initb',
        quantity: '1.0000 SYS',
        memo: ''
      },
      authorization: []
    }
    assertSerializer(structs.action, value)
  })

  it('force hex', () => {
    const evo = Evo({forceActionDataHex: true})
    const {structs, types} = evo.fc
    const value = {
      account: 'evo.token',
      name: 'transfer',
      data: {
        from: 'inita',
        to: 'initb',
        quantity: '1.0000 SYS',
        memo: ''
      },
      authorization: []
    }
    assertSerializer(structs.action, value, value)
  })

  it('unknown type', () => {
    const evo = Evo({forceActionDataHex: false})
    const {structs, types} = evo.fc
    const value = {
      account: 'evo.token',
      name: 'mytype',
      data: '030a0b0c',
      authorization: []
    }
    assertSerializer(structs.action, value)
  })
})

function assertSerializer (type, value, fromObjectResult = null, toObjectResult = fromObjectResult) {
  const obj = type.fromObject(value) // tests fromObject
  const buf = Fcbuffer.toBuffer(type, value) // tests appendByteBuffer
  const obj2 = Fcbuffer.fromBuffer(type, buf) // tests fromByteBuffer
  const obj3 = type.toObject(obj) // tests toObject

  if(!fromObjectResult && !toObjectResult) {
    assert.deepEqual(value, obj3, 'serialize object')
    assert.deepEqual(obj3, obj2, 'serialize buffer')
    return
  }

  if(fromObjectResult) {
    assert(fromObjectResult, obj, 'fromObjectResult')
    assert(fromObjectResult, obj2, 'fromObjectResult')
  }

  if(toObjectResult) {
    assert(toObjectResult, obj3, 'toObjectResult')
  }
}
