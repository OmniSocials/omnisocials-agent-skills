#!/usr/bin/env node
"use strict";
// The CLI moved to skills/omnisocials/scripts/omnisocials.js so that
// `npx skills add` installs ship it inside the skill folder. This shim
// keeps the old repo-root path working for existing clones and docs.
require("../skills/omnisocials/scripts/omnisocials.js");
