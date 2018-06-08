/* eslint-env mocha */
const assert = require('assert')
const fs = require('fs')

const Evo = require('.')
const {ecc} = Evo.modules
const {Keystore} = require('evojs-keygen')

const wif = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3'

describe('version', () => {
  it('exposes a version number', () => {
    assert.ok(Evo.version)
  })
})

describe('offline', () => {
  const headers = {
    expiration: new Date().toISOString().split('.')[0],
    ref_block_num: 1,
    ref_block_prefix: 452435776,
    net_usage_words: 0,
    max_cpu_usage_ms: 0,
    delay_sec: 0,
    context_free_actions: [],
    transaction_extensions: []
  }

  it('transaction', async function() {
    const privateKey = await ecc.unsafeRandomKey()

    const evo = Evo({
      keyProvider: privateKey,
      // httpEndpoint: 'https://doesnotexist.example.org',
      transactionHeaders: (expireInSeconds, callback) => {
        callback(null/*error*/, headers)
      },
      broadcast: false,
      sign: true
    })

    const memo = ''
    const trx = await evo.transfer('bankers', 'people', '1000000 SYS', memo)

    assert.deepEqual({
      expiration: trx.transaction.transaction.expiration,
      ref_block_num: trx.transaction.transaction.ref_block_num,
      ref_block_prefix: trx.transaction.transaction.ref_block_prefix,
      net_usage_words: 0,
      max_cpu_usage_ms: 0,
      delay_sec: 0,
      context_free_actions: [],
      transaction_extensions: []
    }, headers)

    assert.equal(trx.transaction.signatures.length, 1, 'expecting 1 signature')
  })
})

// some transactions that don't broadcast may require Api lookups
if(process.env['NODE_ENV'] === 'development') {

  // describe('networks', () => {
  //   it('testnet', (done) => {
  //     const evo = Evo()
  //     evo.getBlock(1, (err, block) => {
  //       if(err) {
  //         throw err
  //       }
  //       done()
  //     })
  //   })
  // })

  describe('Contracts', () => {
    it('Messages do not sort', async function() {
      const local = Evo()
      const opts = {sign: false, broadcast: false}
      const tx = await local.transaction(['currency', 'evo.token'], ({currency, evo_token}) => {
        // make sure {account: 'evo.token', ..} remains first
        evo_token.transfer('inita', 'initd', '1.1 SYS', '')

        // {account: 'currency', ..} remains second (reverse sort)
        currency.transfer('inita', 'initd', '1.2 CUR', '')

      }, opts)
      assert.equal(tx.transaction.transaction.actions[0].account, 'evo.token')
      assert.equal(tx.transaction.transaction.actions[1].account, 'currency')
    })
  })

  describe('Contract', () => {
    function deploy(contract, account = 'inita') {
      it(`deploy ${contract}@${account}`, async function() {
        this.timeout(4000)
        // console.log('todo, skipping deploy ' + `${contract}@${account}`)
        const config = {binaryen: require("binaryen"), keyProvider: wif}
        const evo = Evo(config)

        const wasm = fs.readFileSync(`docker/contracts/${contract}/${contract}.wasm`)
        const abi = fs.readFileSync(`docker/contracts/${contract}/${contract}.abi`)


        await evo.setcode(account, 0, 0, wasm)
        await evo.setabi(account, JSON.parse(abi))

        const code = await evo.getCode(account)

        const diskAbi = JSON.parse(abi)
        delete diskAbi.____comment
        if(!diskAbi.error_messages) {
          diskAbi.error_messages = []
        }

        assert.deepEqual(diskAbi, code.abi)
      })
    }

    // When ran multiple times, deploying to the same account
    // avoids a same contract version deploy error.
    // TODO: undeploy contract instead (when API allows this)

    deploy('evo.msig')
    deploy('evo.token')
    deploy('evo.bios')
    deploy('evo.system')
  })

  describe('Contracts Load', () => {
    function load(name) {
      it(name, async function() {
        const evo = Evo()
        const contract = await evo.contract(name)
        assert(contract, 'contract')
      })
    }
    load('evo')
    load('evo.token')
  })

  describe('transactions', () => {
    const signProvider = ({sign, buf}) => sign(buf, wif)
    const promiseSigner = (args) => Promise.resolve(signProvider(args))

    it('usage', () => {
      const evo = Evo({signProvider})
      evo.transfer()
    })

    // A keyProvider can return private keys directly..
    it('keyProvider private key', () => {

      // keyProvider should return an array of keys
      const keyProvider = () => {
        return [wif]
      }

      const evo = Evo({keyProvider})

      return evo.transfer('inita', 'initb', '1 SYS', '', false).then(tr => {
        assert.equal(tr.transaction.signatures.length, 1)
        assert.equal(typeof tr.transaction.signatures[0], 'string')
      })
    })

    it('keyProvider multiple private keys (get_required_keys)', () => {

      // keyProvider should return an array of keys
      const keyProvider = () => {
        return [
          '5K84n2nzRpHMBdJf95mKnPrsqhZq7bhUvrzHyvoGwceBHq8FEPZ',
          wif
        ]
      }

      const evo = Evo({keyProvider})

      return evo.transfer('inita', 'initb', '1.274 SYS', '', false).then(tr => {
        assert.equal(tr.transaction.signatures.length, 1)
        assert.equal(typeof tr.transaction.signatures[0], 'string')
      })
    })

    // If a keystore is used, the keyProvider should return available
    // public keys first then respond with private keys next.
    it('keyProvider public keys then private key', () => {
      const pubkey = ecc.privateToPublic(wif)

      // keyProvider should return a string or array of keys.
      const keyProvider = ({transaction, pubkeys}) => {
        if(!pubkeys) {
          assert.equal(transaction.actions[0].name, 'transfer')
          return [pubkey]
        }

        if(pubkeys) {
          assert.deepEqual(pubkeys, [pubkey])
          return [wif]
        }
        assert(false, 'unexpected keyProvider callback')
      }

      const evo = Evo({keyProvider})

      return evo.transfer('inita', 'initb', '9 SYS', '', false).then(tr => {
        assert.equal(tr.transaction.signatures.length, 1)
        assert.equal(typeof tr.transaction.signatures[0], 'string')
      })
    })

    it('keyProvider from evojs-keygen', () => {
      const keystore = Keystore('uid')
      keystore.deriveKeys({parent: wif})
      const evo = Evo({keyProvider: keystore.keyProvider})
      return evo.transfer('inita', 'initb', '12 SYS', '', true)
    })

    it('keyProvider return Promise', () => {
      const evo = Evo({keyProvider: new Promise(resolve => {resolve(wif)})})
      return evo.transfer('inita', 'initb', '1.618 SYS', '', true)
    })

    it('signProvider', () => {
      const customSignProvider = ({buf, sign, transaction}) => {

        // All potential keys (EOS6MRy.. is the pubkey for 'wif')
        const pubkeys = ['EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV']

        return evo.getRequiredKeys(transaction, pubkeys).then(res => {
          // Just the required_keys need to sign
          assert.deepEqual(res.required_keys, pubkeys)
          return sign(buf, wif) // return hex string signature or array of signatures
        })
      }
      const evo = Evo({signProvider: customSignProvider})
      return evo.transfer('inita', 'initb', '2 SYS', '', false)
    })

    it('create asset', async function() {
      const evo = Evo({signProvider})
      const pubkey = 'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV'
      const auth = {authorization: 'evo.token'}
      await evo.create('evo.token', '10000 ' + randomAsset(), auth)
      await evo.create('evo.token', '10000.00 ' + randomAsset(), auth)
    })

    it('newaccount (broadcast)', () => {
      const evo = Evo({signProvider})
      const pubkey = 'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV'
      const name = randomName()

      return evo.transaction(tr => {
        tr.newaccount({
          creator: 'evo',
          name,
          owner: pubkey,
          active: pubkey
        })
        tr.buyrambytes({
          payer: 'evo',
          receiver: name,
          bytes: 8192
        })
        tr.delegatebw({
          from: 'evo',
          receiver: name,
          stake_net_quantity: '1.0000 SYS',
          stake_cpu_quantity: '1.0000 SYS',
          transfer: 0
        })
      })
    })

    it('mockTransactions pass', () => {
      const evo = Evo({signProvider, mockTransactions: 'pass'})
      return evo.transfer('inita', 'initb', '1 SYS', '').then(transfer => {
        assert(transfer.mockTransaction, 'transfer.mockTransaction')
      })
    })

    it('mockTransactions fail', () => {
      const logger = { error: null }
      const evo = Evo({signProvider, mockTransactions: 'fail', logger})
      return evo.transfer('inita', 'initb', '1 SYS', '').catch(error => {
        assert(error.indexOf('fake error') !== -1, 'expecting: fake error')
      })
    })

    it('transfer (broadcast)', () => {
      const evo = Evo({signProvider})
      return evo.transfer('inita', 'initb', '1 SYS', '')
    })

    it('transfer custom token precision (broadcast)', () => {
      const evo = Evo({signProvider})
      return evo.transfer('inita', 'initb', '1.618 PHI', '')
    })

    it('transfer custom authorization (broadcast)', () => {
      const evo = Evo({signProvider})
      return evo.transfer('inita', 'initb', '1 SYS', '', {authorization: 'inita@owner'})
    })

    it('transfer custom authorization sorting (no broadcast)', () => {
      const evo = Evo({signProvider})
      return evo.transfer('inita', 'initb', '1 SYS', '',
        {authorization: ['initb@owner', 'inita@owner'], broadcast: false}
      ).then(({transaction}) => {
        const ans = [
          {actor: 'inita', permission: 'owner'},
          {actor: 'initb', permission: 'owner'}
        ]
        assert.deepEqual(transaction.transaction.actions[0].authorization, ans)
      })
    })

    it('transfer (no broadcast)', () => {
      const evo = Evo({signProvider})
      return evo.transfer('inita', 'initb', '1 SYS', '', {broadcast: false})
    })

    it('transfer (no broadcast, no sign)', () => {
      const evo = Evo({signProvider})
      const opts = {broadcast: false, sign: false}
      return evo.transfer('inita', 'initb', '1 SYS', '', opts).then(tr =>
        assert.deepEqual(tr.transaction.signatures, [])
      )
    })

    it('transfer sign promise (no broadcast)', () => {
      const evo = Evo({signProvider: promiseSigner})
      return evo.transfer('inita', 'initb', '1 SYS', '', false)
    })

    it('action to unknown contract', () => {
      const logger = { error: null }
      return Evo({signProvider, logger}).contract('unknown432')
      .then(() => {throw 'expecting error'})
      .catch(error => {
        assert(/unknown key/.test(error.toString()),
          'expecting "unknown key" error action, instead got: ' + error)
      })
    })

    it('action to contract', () => {
      return Evo({signProvider}).contract('evo.token').then(token => {
        return token.transfer('inita', 'initb', '1 SYS', '')
          // transaction sent on each command
          .then(tr => {
            assert.equal(1, tr.transaction.transaction.actions.length)

            return token.transfer('initb', 'inita', '1 SYS', '')
              .then(tr => {assert.equal(1, tr.transaction.transaction.actions.length)})
          })
      }).then(r => {assert(r == undefined)})
    })

    it('action to contract atomic', async function() {
      let amt = 1 // for unique transactions
      const evo = Evo({signProvider})

      const trTest = evo_token => {
        assert(evo_token.transfer('inita', 'initb', amt + ' SYS', '') == null)
        assert(evo_token.transfer('initb', 'inita', (amt++) + ' SYS', '') == null)
      }

      const assertTr = tr =>{
        assert.equal(2, tr.transaction.transaction.actions.length)
      }

      //  contracts can be a string or array
      await assertTr(await evo.transaction(['evo.token'], ({evo_token}) => trTest(evo_token)))
      await assertTr(await evo.transaction('evo.token', evo_token => trTest(evo_token)))
    })

    it('action to contract (contract tr nesting)', function () {
      this.timeout(4000)
      const tn = Evo({signProvider})
      return tn.contract('evo.token').then(evo_token => {
        return evo_token.transaction(tr => {
          tr.transfer('inita', 'initb', '1 SYS', '')
          tr.transfer('inita', 'initc', '2 SYS', '')
        }).then(() => {
          return evo_token.transfer('inita', 'initb', '3 SYS', '')
        })
      })
    })

    it('multi-action transaction (broadcast)', () => {
      const evo = Evo({signProvider})
      return evo.transaction(tr => {
        assert(tr.transfer('inita', 'initb', '1 SYS', '') == null)
        assert(tr.transfer({from: 'inita', to: 'initc', quantity: '1 SYS', memo: ''}) == null)
      }).then(tr => {
        assert.equal(2, tr.transaction.transaction.actions.length)
      })
    })

    it('multi-action transaction no inner callback', () => {
      const evo = Evo({signProvider})
      return evo.transaction(tr => {
        tr.transfer('inita', 'inita', '1 SYS', '', cb => {})
      })
      .then(() => {throw 'expecting rollback'})
      .catch(error => {
        assert(/Callback during a transaction/.test(error), error)
      })
    })

    it('multi-action transaction error rollback', () => {
      const evo = Evo({signProvider})
      return evo.transaction(tr => {throw 'rollback'})
      .then(() => {throw 'expecting rollback'})
      .catch(error => {
        assert(/rollback/.test(error), error)
      })
    })

    it('multi-action transaction Promise.reject rollback', () => {
      const evo = Evo({signProvider})
      return evo.transaction(tr => Promise.reject('rollback'))
      .then(() => {throw 'expecting rollback'})
      .catch(error => {
        assert(/rollback/.test(error), error)
      })
    })

    it('custom transfer', () => {
      const evo = Evo({signProvider})
      return evo.transaction(
        {
          actions: [
            {
              account: 'evo',
              name: 'transfer',
              data: {
                from: 'inita',
                to: 'initb',
                quantity: '13 SYS',
                memo: '爱'
              },
              authorization: [{
                actor: 'inita',
                permission: 'active'
              }]
            }
          ]
        },
        {broadcast: false}
      )
    })
  })

  // ./evoc set contract currency build/contracts/currency/currency.wasm build/contracts/currency/currency.abi
  it('Transaction ABI lookup', async function() {
    const evo = Evo()
    const tx = await evo.transaction(
      {
        actions: [
          {
            account: 'currency',
            name: 'transfer',
            data: {
              from: 'inita',
              to: 'initb',
              quantity: '13 CUR',
              memo: ''
            },
            authorization: [{
              actor: 'inita',
              permission: 'active'
            }]
          }
        ]
      },
      {sign: false, broadcast: false}
    )
    assert.equal(tx.transaction.transaction.actions[0].account, 'currency')
  })

} // if development

const randomName = () => {
  const name = String(Math.round(Math.random() * 1000000000)).replace(/[0,6-9]/g, '')
  return 'a' + name + '111222333444'.substring(0, 11 - name.length) // always 12 in length
}

const randomAsset = () =>
  ecc.sha256(String(Math.random())).toUpperCase().replace(/[^A-Z]/g, '').substring(0, 7)
