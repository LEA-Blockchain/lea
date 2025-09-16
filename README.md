# Lea CLI

Command-line tool for interacting with the Lea blockchain using the Web3 SDK.

Requirements
- Node.js >= 19

Install
- npx: `npx @getlea/lea --help` (or `npx lea` if your npx resolves the single-bin automatically)
- Global: `npm i -g @getlea/lea` then `lea --help`

When publishing
- Package name: `@getlea/lea`
- Ensure the binary is executable (handled by prepublish script)

Usage
- Global options:
- `--cluster <devnet|testnet|mainnet-beta|local|URL>` (default: mainnet-beta)
  - `-o, --outfile <path>` write decoded JSON result to a file (also printed)
  - `--quiet` suppress stderr status line
- Address and keyfiles:
  - Any argument ending with `.json` is treated as a keyfile from `lea-keygen`; its `address` is used.
  - Otherwise the value is interpreted as a Bech32m Lea address.

Commands
- `keygen [new|verify]` — proxy to `@getlea/keygen` to generate and verify keysets
- `publish-keyset --key ./example.json`
- `mint --key ./minter.json --to <address|./recipient.json> --amount <uLEA>`
- `transfer --key ./sender.json --to <address|./recipient.json> --amount <uLEA>`
- `burn --key ./account.json --amount <uLEA>`
- `get-balance --address <address|./account.json>`
- `get-last-tx-hash --address <address|./account.json>`
- `get-allowed-mint --address <address|./account.json>`
- `get-current-supply`
- `mint-whitelist --key ./authority.json --to <address|./recipient.json> --amount <uLEA>`

Keygen
- Overview: `lea keygen` runs the `@getlea/keygen` tool.
- New keyset:
  - `lea keygen new --outfile my-wallet.json`
  - Options: `--no-outfile` to print JSON to stdout, `--force` to overwrite, `--seed <64-hex>` to derive from a master seed.
- Verify keyset address:
  - `lea keygen verify ./my-wallet.json`

Examples
- Publish: `npx @getlea/lea publish-keyset --key ./example.json --cluster devnet`
- Transfer: `npx @getlea/lea transfer --key ./sender.json --to ./recipient.json --amount 1 -o tx.json`
- Balance: `npx @getlea/lea get-balance --address lea1xyz... --quiet`
