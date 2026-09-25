# doors: contacts with the outside world a product line may reach only through a seam ($ is the host's seam)
new Date[(]
Date[.]now[(]
performance[.]now[(]
Math[.]random[(]
crypto[.]random
process[.](env|argv|cwd|exit|hrtime)
from ['"](node:)?(fs|fs/promises|child_process|net|http|https|os)['"]
require[(]['"](node:)?(fs|child_process|net|http|https|os)['"]
(^|[^A-Za-z0-9_.$])fetch[(]
set(Timeout|Interval|Immediate)[(]
