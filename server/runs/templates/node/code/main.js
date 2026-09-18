// The automation's script. It runs in the run's own directory with BIOM_VAULT,
// BIOM_RUN and BIOM_API in its environment; what it prints is the run's log.
console.log("vault:", process.env.BIOM_VAULT);
console.log("run:", process.env.BIOM_RUN);
