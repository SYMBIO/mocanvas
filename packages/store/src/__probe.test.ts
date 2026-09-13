import { it } from "vitest"
it("probe", () => {
  console.log("NODE_ENV=" + JSON.stringify(process.env["NODE_ENV"]))
})
