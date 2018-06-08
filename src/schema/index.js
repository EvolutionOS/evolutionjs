const schema = Object.assign(
  {},
  require('./chain_types.json'),
  require('./eos_system.json'),
  require('./eos_token.json')
)

module.exports = schema
