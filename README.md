<p align="center">
	<img src="https://nginxproxymanager.com/github.png">
	<br><br>
	<img src="https://img.shields.io/badge/version-2.17.1-green.svg?style=for-the-badge">
	<a href="https://hub.docker.com/repository/docker/jc21/nginx-proxy-manager">
		<img src="https://img.shields.io/docker/stars/jc21/nginx-proxy-manager.svg?style=for-the-badge">
	</a>
	<a href="https://hub.docker.com/repository/docker/jc21/nginx-proxy-manager">
		<img src="https://img.shields.io/docker/pulls/jc21/nginx-proxy-manager.svg?style=for-the-badge">
	</a>
</p>

> **HME fork.** This is [cchapman-hme/hme-nginx-proxy-manager](https://github.com/cchapman-hme/hme-nginx-proxy-manager),
> a fork of [NginxProxyManager/nginx-proxy-manager](https://github.com/NginxProxyManager/nginx-proxy-manager) that adds
> **Microsoft Entra ID (Azure AD) single sign-on per proxy host**. See [Fork notes](#fork-notes) below; the rest of this
> README is upstream's.

This project comes as a pre-built Docker image that enables you to easily forward to your websites
running at home or otherwise, including free SSL, without having to know too much about Nginx or Letsencrypt.

- [Quick Setup](#quick-setup)
- [Full Setup](https://nginxproxymanager.com/setup/)
- [Screenshots](https://nginxproxymanager.com/screenshots/)

## Project Goal

I created this project to fill a personal need to provide users with an easy way to accomplish reverse
proxying hosts with SSL termination, and it had to be so easy that a monkey could do it. This goal hasn't changed.
While there might be advanced options, they are optional, and the project should be as simple as possible
so that the barrier to entry here is low.

<a href="https://www.buymeacoffee.com/jc21" target="_blank"><img src="http://public.jc21.com/github/by-me-a-coffee.png" alt="Buy Me A Coffee" style="height: 51px !important;width: 217px !important;" ></a>


## Features

- Beautiful and Secure Admin Interface based on [Tabler](https://tabler.github.io/)
- Easily create forwarding domains, redirections, streams, and 404 hosts without knowing anything about Nginx
- Free SSL using Let's Encrypt or provide your own custom SSL certificates
- Access Lists and basic HTTP Authentication for your hosts
- Advanced Nginx configuration available for super users
- User management, permissions, and audit log

::: warning
`armv7` is no longer supported in version 2.14+. This is due to Nodejs dropping support for armhf. Please
use the `2.13.7` image tag if this applies to you.
:::

## Hosting your home network

I won't go into too much detail here, but here are the basics for someone new to this self-hosted world.

1. Your home router will have a Port Forwarding section somewhere. Log in and find it
2. Add port forwarding for ports 80 and 443 to the server hosting this project
3. Configure your domain name details to point to your home, either with a static ip or a service like
   - DuckDNS
   - [Amazon Route53](https://github.com/jc21/route53-ddns)
   - [Cloudflare](https://github.com/jc21/cloudflare-ddns)
4. Use the Nginx Proxy Manager as your gateway to forward to your other web-based services

## Quick Setup

1. [Install Docker](https://docs.docker.com/install/)
2. Create a docker-compose.yml file similar to this:

```yml
services:
  app:
    image: 'docker.io/jc21/nginx-proxy-manager:latest'
    restart: unless-stopped
    ports:
      - '80:80'
      - '81:81'
      - '443:443'
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
```

This is the bare minimum configuration required. See the [documentation](https://nginxproxymanager.com/setup/) for more.

3. Bring up your stack by running

```bash
docker compose up -d
```

4. Log in to the Admin UI

When your docker container is running, connect to it on port `81` for the admin interface.
Sometimes this can take a little bit because of the entropy of keys.

[http://127.0.0.1:81](http://127.0.0.1:81)


## Contributing

All are welcome to create pull requests for this project, against the `develop` branch. Official releases are created from the `master` branch.

CI is used in this project. All PR's must pass before being considered. After passing,
docker builds for PR's are available on dockerhub for manual verifications.

Documentation within the `develop` branch is available for preview at
[https://develop.nginxproxymanager.com](https://develop.nginxproxymanager.com)


### Contributors

Special thanks to [all of our contributors](https://github.com/NginxProxyManager/nginx-proxy-manager/graphs/contributors).


## Getting Support

1. [Found a bug?](https://github.com/NginxProxyManager/nginx-proxy-manager/issues)
2. [Discussions](https://github.com/NginxProxyManager/nginx-proxy-manager/discussions)
3. [Reddit](https://reddit.com/r/nginxproxymanager)

## Fork notes

### What is added

- **Entra ID SSO per proxy host.** Each proxy host has an *SSO* tab (tenant ID, client ID, client secret, cookie
  domain, required groups). Protected hosts get an nginx `auth_request` to an internal sidecar that runs the OAuth 2.0
  authorization-code flow with MSAL. A global kill switch lives under *Settings → Azure SSO*.
- Design and security details: [backend/sso/README.md](backend/sso/README.md).

### Images

```
ghcr.io/cchapman-hme/hme-nginx-proxy-manager:latest        # latest fork release
ghcr.io/cchapman-hme/hme-nginx-proxy-manager:2.16.0        # fork build of upstream 2.16.0
ghcr.io/cchapman-hme/hme-nginx-proxy-manager:2.16.0-hme.1  # exact release
ghcr.io/cchapman-hme/hme-nginx-proxy-manager:develop       # tracking build of develop
```

Example stacks are in [docker/docker-compose.prod.yml](docker/docker-compose.prod.yml) (MariaDB) and
[docker/docker-compose.greenfield.yml](docker/docker-compose.greenfield.yml) (SQLite). Database passwords are read
from the environment; never commit them.

### Branches, releases and automation

| Branch    | Role                                                                                     |
|-----------|------------------------------------------------------------------------------------------|
| `develop` | Fork development. Merged daily with upstream `develop` by the *Upstream sync and release* workflow. |
| `master`  | Release branch. Only ever receives upstream release tags and `develop`.                  |

- **One fork release per upstream release.** When upstream publishes `vX.Y.Z`, the daily workflow merges that tag and
  `develop` into `master`, tags `vX.Y.Z-hme.1`, builds the image and publishes a GitHub Release. The release step runs
  before `develop` takes new upstream commits, so a release is always *upstream release + fork changes*.
- **Blocked automation opens an Issue** (labels `upstream-sync` / `release` + `needs-attention`) with the conflicting
  files and the commands to resolve them. Resolve, push, and close the issue.
- **CI** ([ci.yml](.github/workflows/ci.yml)) runs backend and frontend lint, unit tests, the SSO sidecar tests and a
  Docker build on every push and pull request. Pushes to `develop` publish the `develop` image.
- A release can be rebuilt or cut by hand with the *Release* workflow and a tag of the form `vX.Y.Z-hme.N`.
