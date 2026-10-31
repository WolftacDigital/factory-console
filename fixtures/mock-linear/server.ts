// Standalone mock Linear: MOCK_LINEAR_PORT, MOCK_LINEAR_FIXTURE (temp copy of linear.json), MOCK_LINEAR_PERSIST=1.
// GET / returns the recorded writes. Point the console's LINEAR_API_URL at http://127.0.0.1:<port>/graphql.
import { createMockLinear } from "./mock";

const mock = createMockLinear({
  fixture: process.env.MOCK_LINEAR_FIXTURE || undefined,
  persist: process.env.MOCK_LINEAR_PERSIST === "1",
  failComment: process.env.MOCK_LINEAR_FAIL_COMMENT === "1",
});
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.MOCK_LINEAR_PORT || 8121), fetch: mock.fetch });
console.log(`mock Linear on http://${server.hostname}:${server.port}/graphql`);
