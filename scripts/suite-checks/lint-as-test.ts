# lint as test: a test reading source text instead of running behaviour
readFileSync[(][^)]*(src|hooks)/
new ESLint[(]
[.]toContain[(]['"](import|export|function|const)
