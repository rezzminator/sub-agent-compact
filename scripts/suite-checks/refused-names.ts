# refused names, in ids and titles: a bug id, a date, a wave or team word, line N
(^|[^a-z])(bug|issue|ticket|jira|gh|pr)-?[0-9]
[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]
(^|[^a-z])(wave|sprint|squad|team)([^a-z]|$)
(^|[^a-z])line[- ][0-9]
