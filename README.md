# trellis-masker
Microservice using oada-jobs that will mask all instances of keys it finds in any vdocs.  POST 
a `vdoc` link into its queue at `/bookmarks/services/trellis-masker` and it will create a masked
copy of that resource.  

Currently, `KEYS_TO_MASK` is hard-coded as `[ 'location' ]`.  Any resource which contains a `location`
key at any level will have that key replaced by a mask.  Future feature will allow overriding this
via environment varable, or allowing more flexibility based on document `_type`.

## Installation
```bash
cd path/to/your/oada-srvc-docker
cd services-available
git clone git@github.com:trellisfw/trellis-masker.git
cd ../services-enabled
ln -s ../services-available/trellis-masker .
oada up -d trellis-masker
```

## Overriding defaults for Production
You can pass the `domain` and `token` environment variables.  The simplest way to manage that 
consistently is using the `z_tokens` method described in [https://github.com/oada/oada-docs].
The `docker-compose.yml` file would look like this:
```docker-compose
version: '3'

services:
  ##########################################
  # Overrides for oada-core services:
  ##########################################
  admin:
    volumes:
      - ./services-available/z_tokens:/code/z_tokens
      
  ###############################################
  # Add tokens for all services that need them:
  ###############################################
  trellis-masker:
    volumes:
      - ./services-available/z_tokens/private_key.jwk:/private_key.jwk
    environment:
      - token=tokentooverrideonproduction
      - domain=domain.for.production
      - privateJWK=/private_key.jwk
```
