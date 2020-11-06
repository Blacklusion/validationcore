# Validationcore

Validator for EOSIO endpoints written in Typescript. Can be used in pager-mode, which will send a list of telegram subscribers status updates about their endpoints. The validationcore is also designed to run in standalone mode, capturing data about an EOSIO chain and storing them in a database.

## Validation process

In a set interval (10min by default), a validation will be performed. The validation will check for the chains.json at the regged url of the guild and use the provided bp.json to evaluate all endpoints of that guild for main- and testnet. This includes the categories:

- Organization: Validate general information provided in chains.json and bp.json, such as websites, location and contact information
- P2P: The validationcore tries to connect to the provided peers and measures block transmission speed
- API: Version of the api node and typical api calls are tested
- History: Typical api calls are tested for v1 and v2 (Hyperion). For Hyperion /v2/health will also be evaluated.

## Pager mode

Pager mode requires an additional telegram microservice. The validationcore will format the messages and connect to the telegram-service. The telegram-service will handle distribution of the messages and handle user interaction (e.g. will not send messages if the user has muted messages for Api category).
