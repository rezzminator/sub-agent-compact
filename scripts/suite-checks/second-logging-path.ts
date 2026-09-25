# second logging path: product output that bypasses the one decision-log writer
console[.](log|warn|error|info|debug)[(]
process[.](stdout|stderr)[.]write[(]
appendFile(Sync)?[(]
