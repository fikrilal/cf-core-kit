## What changed

<!-- One paragraph. Behaviour first: what does the running system do differently? -->

## Risk class

<!-- The highest risk rule the diff hits (`cfkit ci classify` prints it); the lane follows from this. -->

- [ ] low · [ ] medium · [ ] high — effective risk:
- Lane: [ ] fast · [ ] full · [ ] ci (runtime required: yes / no)

## Impact areas

<!-- Answer honestly: this is what a reviewer checks the diff against. -->

| Area                              | Touched? | Note |
| --------------------------------- | -------- | ---- |
| API / contract (operations, DTOs) | yes / no |      |
| DB / migrations                   | yes / no |      |
| Auth / session                    | yes / no |      |
| Queue / jobs                      | yes / no |      |
| Config / secrets                  | yes / no |      |
| Observability                     | yes / no |      |
| Budget / free-tier footprint      | yes / no |      |
| Harness / CI                      | yes / no |      |

## Contract and parity impact

<!-- Which operations change, whether `npm run contract:emit` was regenerated, and how the parity manifest moved. -->

## Runtime evidence

<!-- Pointer to the evidence for runtime-affecting changes: `cfkit task verify` episode/diagnostic paths,
     `verify --profile runtime` output, the credentialed lane record, or `none — no runtime path touched`. -->

## Checks not run, and why

<!-- Anything skipped, with the reason (credentialed lane, unrelated area, cost). "None" is a valid answer. -->

## Review focus

<!-- Where the risk concentrates, and what a reviewer should look at first. -->
