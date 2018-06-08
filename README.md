

# Evolutionjs

Fork of the Evojs general purpose library.

### Usage (read-only)

```javascript
Evo= require('evolutionjs') // Evo = require('./src')

evo = Evo() // 127.0.0.1:8888

// All API methods print help when called with no-arguments.
evo.getBlock()

// Next, your going to need nodevod running on localhost:8888 (see ./docker)

// If a callback is not provided, a Promise is returned
evo.getBlock(1).then(result => {console.log(result)})

// Parameters can be sequential or an object
evo.getBlock({block_num_or_id: 1}).then(result => console.log(result))

// Callbacks are similar
callback = (err, res) => {err ? console.error(err) : console.log(res)}
evo.getBlock(1, callback)
evo.getBlock({block_num_or_id: 1}, callback)

// Provide an empty object or a callback if an API call has no arguments
evo.getInfo({}).then(result => {console.log(result)})
```
