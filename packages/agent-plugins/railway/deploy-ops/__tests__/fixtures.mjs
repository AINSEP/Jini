// Simulated from public API docs, not recorded. No live credentials or network.
// https://docs.railway.com/integrations/api/{manage-projects,manage-services,manage-deployments,manage-variables}
import assert from "node:assert/strict";
export const AT = "2026-10-24T12:00:00.000Z";
export const PROJECT = "11111111-1111-4111-8111-111111111111";
export const ENVIRONMENT = "22222222-2222-4222-8222-222222222222";
export const SERVICE = "33333333-3333-4333-8333-333333333333";
export const RUN = "44444444-4444-4444-8444-444444444444";
export const OTHER = "55555555-5555-4555-8555-555555555555";
export const TARGET = `${PROJECT}:${ENVIRONMENT}:${SERVICE}`;
export const IDS = { projectId: PROJECT, environmentId: ENVIRONMENT, serviceId: SERVICE };
export const API = "https://backboard.railway.com/graphql/v2";
export const QUERIES = {
  targets: `query targets($workspaceId: String) {
  projects(workspaceId: $workspaceId, first: 10) {
    pageInfo { hasNextPage }
    edges { node { id name environments(first: 10) {
      pageInfo { hasNextPage }
      edges { node { id name serviceInstances(first: 50) {
        pageInfo { hasNextPage }
        edges { node { serviceId serviceName } }
      } } }
    } } }
  }
}`,
  deployment: `query deployment($id: String!) {
  deployment(id: $id) { id serviceId environmentId status }
}`,
  latest: `query latest($serviceId: String!, $environmentId: String!) {
  serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
    latestDeployment { id serviceId environmentId status }
  }
}`,
  deploy: `mutation deploy($serviceId: String!, $environmentId: String!, $commitSha: String) {
  serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId, commitSha: $commitSha)
}`,
  logs: `query logs($deploymentId: String!, $limit: Int) {
  deploymentLogs(deploymentId: $deploymentId, limit: $limit) { timestamp message severity }
}`,
  variables: `query variables($projectId: String!, $environmentId: String!, $serviceId: String) {
  variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
}`,
  set: `mutation set($input: VariableUpsertInput!) { variableUpsert(input: $input) }`,
  unset: `mutation unset($input: VariableDeleteInput!) { variableDelete(input: $input) }`,
};
export function request({ operation, variables }, _options = {}) {
  return { method: "POST", url: API, body: { query: QUERIES[operation], variables } };
}
export function connection({ entries, more = false }, _options = {}) {
  return { edges: entries.map(node => ({ node })), pageInfo: { hasNextPage: more } };
}
export function discovery(_input = {}, _options = {}) {
  return { projects: connection({ entries: [{ id: PROJECT, name: "Shop", environments: connection({ entries: [{ id: ENVIRONMENT, name: "production", serviceInstances: connection({ entries: [{ serviceId: SERVICE, serviceName: "web" }] }) }] }) }] }) };
}
export function deployed({ state = "SUCCESS", ...overrides } = {}, _options = {}) {
  return { id: RUN, serviceId: SERVICE, environmentId: ENVIRONMENT, status: state, ...overrides };
}
/** Scripted bound-context responses; a missing script entry fails instead of reaching the network. */
export function context({ replies = [] } = {}, _options = {}) {
  const calls = [];
  return { calls, nowIso: () => AT, fail: message => { throw new Error(message); },
    get: async () => { throw new Error("Railway must use GraphQL POST."); },
    send: async input => {
      calls.push(input);
      assert.ok(calls.length <= replies.length, "Unexpected request");
      const reply = replies[calls.length - 1];
      if (reply instanceof Error) throw reply;
      return { status: 200, text: "", ...reply };
    } };
}
export function data({ value }, _options = {}) { return { json: { data: value } }; }
