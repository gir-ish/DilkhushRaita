# Digital Asset Links

`assetlinks.json` belongs here, and nothing else.

It is what tells Android that the installed app and this website are the same
business. Without it a PWABuilder/TWA app opens with a browser address bar
across the top, which is both ugly and a giveaway that it is a wrapped site.

PWABuilder generates the file inside the package it hands you. Drop it in
beside this README, deploy, and confirm it is being served:

    curl https://www.dilkhushraita.com/.well-known/assetlinks.json

Next serves everything under `public/` from the site root, and the middleware
guards only `/admin`, `/account` and `/checkout`, so this path needs no
special handling.
