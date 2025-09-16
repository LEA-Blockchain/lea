#!/bin/bash
node bin/lea.mjs --cluster local publish-keyset --key authority.json
node bin/lea.mjs --cluster local get-last-tx-hash --address authority.json