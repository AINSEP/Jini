---
"@jini-ai/cms": patch
---

Widget writes now record who made them through each channel: the admin widget create, update and area-placement routes vouch `user`, and the assistant's widget create, update and area-placement tools vouch `agent`, so those entry events carry a trusted actor instead of none.
