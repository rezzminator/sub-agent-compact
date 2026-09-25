# wall-clock wait: a sleep, a literal delay, a clock loop, every timer faked
setTimeout[(]
setInterval[(]
(^|[^A-Za-z])sleep[(]
waitForTimeout[(]
Date[.]now[(][)] *[<>+-]
useFakeTimers[(][)]
