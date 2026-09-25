# double in production: an inline stand-in replacing a product module outside the fakes directory
vi[.](mock|doMock|stubGlobal|stubEnv)[(]
[.]mockImplementation(Once)?[(]
[.]mockReturnValue(Once)?[(]
(function|const|let|class) +(memory|inMemory|fake|stub|mock|dummy)[A-Z][A-Za-z0-9]*
