# Dependency matrix (binding)
| module       | may import                        |
|--------------|-----------------------------------|
| core         | stdlib only                       |
| util         | core, stdlib                      |
| svc_a        | core, util, stdlib                |
| svc_b        | core, util, stdlib                |
| legacy       | NOTHING (deprecated, do not import) |
