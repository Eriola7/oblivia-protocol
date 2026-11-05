# Project

Oblivia is MIT-licensed open source, developed at [github.com/Eriola7/oblivia-protocol](https://github.com/Eriola7/oblivia-protocol).

| | |
| --- | --- |
| [Contributing](https://github.com/Eriola7/oblivia-protocol/blob/main/CONTRIBUTING.md) | Setup, conventions and review process |
| [Security policy](https://github.com/Eriola7/oblivia-protocol/blob/main/SECURITY.md) | Report vulnerabilities privately through GitHub security advisories |
| [Support](https://github.com/Eriola7/oblivia-protocol/blob/main/SUPPORT.md) | Getting help and common problems |
| [Code of conduct](https://github.com/Eriola7/oblivia-protocol/blob/main/CODE_OF_CONDUCT.md) | Contributor Covenant 2.1 |
| [Changelog](https://github.com/Eriola7/oblivia-protocol/blob/main/CHANGELOG.md) | Protocol changes; the SDK has [its own](https://github.com/Eriola7/oblivia-protocol/blob/main/sdk/CHANGELOG.md) |
| [License](https://github.com/Eriola7/oblivia-protocol/blob/main/LICENSE) | MIT |

## How these docs are built

The site is built with MkDocs Material from the `docs/` folder. The SDK and program references are generated from the code on every build, by TypeDoc from the SDK's type definitions and from the program's IDL and source comments. CI rebuilds the site in strict mode on every pull request, and the build fails on a broken link, a missing page or an undocumented program instruction.

To build locally:

```bash
npm ci --prefix sdk && npm ci --prefix tools/docs
pip install -r tools/docs/requirements.txt
npm run docs          # generate references and build the site into site/
npm run docs:serve    # live preview at http://127.0.0.1:8000
```
