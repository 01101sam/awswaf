# AWS WAF

Core of bypassing AWS WAF.

# Dev

## Pre-requisites

> Assumed you have Python 3.10 installed already and have a virtual environment setup.

1. Install dependencies `npm i`
2. Install Azure functions core tools
3. Login `az login`

Run `func start`

# Deploy

`func azure functionapp publish awswaf -b remote`
