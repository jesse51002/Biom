"""The automation's script. It runs in the run's own directory with BIOM_VAULT,
BIOM_RUN and BIOM_API in its environment; what it prints is the run's log."""
import os

print("vault:", os.environ.get("BIOM_VAULT"))
print("run:", os.environ.get("BIOM_RUN"))
