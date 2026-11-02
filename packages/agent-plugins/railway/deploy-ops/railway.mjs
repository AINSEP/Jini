/** Railway GraphQL adapter. The host owns auth, HTTP policy, cancellation, polling and auditing. */
const ENDPOINT = "https://backboard.railway.com/graphql/v2";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const QUERIES = {
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

/** Never echo GraphQL errors: partial data and provider diagnostics may contain variable values. */
async function gql(ctx, { query, variables }) {
  const response = await ctx.send({ method: "POST", url: ENDPOINT, body: { query, variables } });
  if (Array.isArray(response.json?.errors)) ctx.fail("Railway could not complete the request. Check the credential and target; check status before retrying a write.");
  if (response.truncated || !response.json?.data || typeof response.json.data !== "object") ctx.fail("Railway returned an incomplete response. Check status before retrying a write.");
  return response.json.data;
}
function id({ ctx, value }, _options = {}) {
  if (typeof value !== "string" || !UUID.test(value)) ctx.fail("Railway IDs must be UUIDs.");
  return value;
}
/** Project is needed for variables; environment/service are needed for every deploy operation. */
function targetIds({ ctx, target }, _options = {}) {
  if (typeof target !== "string" || target.split(":").length !== 3) ctx.fail("Choose a Railway target from list targets: project:environment:service.");
  const [projectId, environmentId, serviceId] = target.split(":").map(value => id({ ctx, value }));
  return { projectId, environmentId, serviceId };
}
function name({ ctx, value }, _options = {}) {
  if (typeof value !== "string" || !/^[A-Za-z_]\w{0,127}$/.test(value)) ctx.fail("Secret name must be an environment variable name.");
  return value;
}
function text({ value }, _options = {}) { return String(value ?? "").slice(0, 2000); }
/** Refuse partial discovery rather than inventing service/environment combinations or hiding pages. */
function nodes({ ctx, connection, cap }, _options = {}) {
  if (!Array.isArray(connection?.edges) || typeof connection?.pageInfo?.hasNextPage !== "boolean") ctx.fail("Railway target discovery returned incomplete data.");
  if (connection.pageInfo.hasNextPage || connection.edges.length > cap) ctx.fail("Railway target discovery is incomplete at its limit. Supply an exact project:environment:service target from the Railway console.");
  if (connection.edges.some(edge => !edge?.node || typeof edge.node !== "object")) ctx.fail("Railway target discovery returned invalid data.");
  return connection.edges.map(edge => edge.node);
}
function label({ ctx, value }, _options = {}) {
  if (typeof value !== "string" || !value) ctx.fail("Railway target discovery returned an invalid name.");
  return text({ value });
}
/** One bounded query: at most 10 projects × 10 environments × 50 actual service instances. */
async function listTargets(ctx, { org } = {}) {
  const variables = org === undefined ? {} : { workspaceId: id({ ctx, value: org }) };
  const data = await gql(ctx, { query: QUERIES.targets, variables });
  const targets = nodes({ ctx, connection: data.projects, cap: 10 }).flatMap(project => projectTargets({ ctx, project }));
  if (targets.length > 500) ctx.fail("Railway target discovery exceeds 500 targets. Supply an exact target from the Railway console.");
  return { platform: "railway", targets };
}
function projectTargets({ ctx, project }, _options = {}) {
  const projectId = id({ ctx, value: project.id });
  const projectName = label({ ctx, value: project.name });
  return nodes({ ctx, connection: project.environments, cap: 10 }).flatMap(environment => {
    const environmentId = id({ ctx, value: environment.id });
    const environmentName = label({ ctx, value: environment.name });
    return nodes({ ctx, connection: environment.serviceInstances, cap: 50 }).map(instance => ({
      id: `${projectId}:${environmentId}:${id({ ctx, value: instance.serviceId })}`,
      name: text({ value: `${projectName} / ${environmentName} / ${label({ ctx, value: instance.serviceName })}` }),
    }));
  });
}
function overall({ status }, _options = {}) {
  const states = {
    SUCCESS: "healthy", FAILED: "failing", CRASHED: "failing",
    BUILDING: "deploying", DEPLOYING: "deploying", INITIALIZING: "deploying", QUEUED: "deploying", WAITING: "deploying",
    REMOVED: "stopped", REMOVING: "stopped", SLEEPING: "stopped", SKIPPED: "stopped",
  };
  return Object.hasOwn(states, status) ? states[status] : "unknown";
}
async function readDeployment({ ctx, ids, runId }, _options = {}) {
  const { serviceId, environmentId } = ids;
  const query = runId === undefined ? QUERIES.latest : QUERIES.deployment;
  const variables = runId === undefined ? { serviceId, environmentId } : { id: id({ ctx, value: runId }) };
  const data = await gql(ctx, { query, variables });
  if (runId !== undefined) return data.deployment;
  if (!data.serviceInstance) ctx.fail("Railway did not return the service instance.");
  return data.serviceInstance.latestDeployment;
}
/** Ownership is read with status, avoiding a separate membership request and its race. */
async function deployment({ ctx, ids, runId }, _options = {}) {
  const result = await readDeployment({ ctx, ids, runId });
  if (result === null && runId === undefined) return null;
  if (!result || typeof result.status !== "string") ctx.fail("Railway did not return a deployment status.");
  id({ ctx, value: result.id });
  if (runId !== undefined && result.id !== runId) ctx.fail("Railway returned a different deployment.");
  if (result.serviceId !== ids.serviceId || result.environmentId !== ids.environmentId) ctx.fail("The Railway deployment does not belong to this target.");
  return result;
}
async function status(ctx, { target, runId }) {
  const result = await deployment({ ctx, ids: targetIds({ ctx, target }), runId });
  const state = result ? overall({ status: result.status }) : "stopped";
  return { platform: "railway", target, state, summary: result ? `Deployment: ${text({ value: result.status })}` : "No deployment exists for this service.", items: result ? [{ id: result.id, state: text({ value: result.status }) }] : [], checkedAt: ctx.nowIso() };
}
async function deploy(ctx, { target, ref }) {
  const { serviceId, environmentId } = targetIds({ ctx, target });
  if (ref !== undefined && (typeof ref !== "string" || !/^[a-f0-9]{40}$/i.test(ref))) ctx.fail("Railway ref must be a full 40-character commit SHA, or omitted to use the service's current commit.");
  const data = await gql(ctx, { query: QUERIES.deploy, variables: { serviceId, environmentId, ...(ref === undefined ? {} : { commitSha: ref }) } });
  // No retries: a lost response may still mean Railway accepted the deployment.
  const runId = id({ ctx, value: data.serviceInstanceDeployV2 });
  return { platform: "railway", target, started: true, runId, ...(ref === undefined ? {} : { sha: ref }), summary: "Railway accepted the deployment. Wait for its status before checking the live site." };
}
function logLine({ ctx, entry }, _options = {}) {
  if (!entry || typeof entry.message !== "string") ctx.fail("Railway returned an invalid log entry.");
  return { message: text({ value: entry.message }), ...(typeof entry.timestamp === "string" ? { at: text({ value: entry.timestamp }) } : {}), ...(typeof entry.severity === "string" ? { level: text({ value: entry.severity }) } : {}) };
}
async function logs(ctx, { target, runId, limit }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) ctx.fail("Log limit must be between 1 and 500.");
  const result = await deployment({ ctx, ids: targetIds({ ctx, target }), runId });
  if (!result) return { platform: "railway", target, lines: [], truncated: false };
  // Read one extra entry to detect a full page without implying this is a streaming log feed.
  const data = await gql(ctx, { query: QUERIES.logs, variables: { deploymentId: result.id, limit: limit + 1 } });
  if (!Array.isArray(data.deploymentLogs)) ctx.fail("Railway did not return log entries.");
  const entries = data.deploymentLogs;
  const lines = entries.slice(0, limit).map(entry => logLine({ ctx, entry }));
  return { platform: "railway", target, lines, truncated: entries.length > limit || entries.slice(0, limit).some(entry => entry.message.length > 2000) };
}
/** Variable values arrive from Railway but are discarded here; no readSecret capability is exported. */
async function listSecrets(ctx, { target }) {
  const data = await gql(ctx, { query: QUERIES.variables, variables: targetIds({ ctx, target }) });
  if (!data.variables || typeof data.variables !== "object" || Array.isArray(data.variables)) ctx.fail("Railway did not return a variables map.");
  const names = Object.keys(data.variables);
  return { secrets: names.slice(0, 500).map(value => ({ name: name({ ctx, value }) })), truncated: names.length > 500 };
}
async function setSecret(ctx, { target, name: key, value }) {
  const input = { ...targetIds({ ctx, target }), name: name({ ctx, value: key }), value, skipDeploys: true };
  const data = await gql(ctx, { query: QUERIES.set, variables: { input } });
  if (data.variableUpsert !== true) ctx.fail("Railway did not confirm the variable write. Check the provider console before retrying.");
  return {};
}
/** The host refuses removal without revision metadata; this required export only defines the vendor call. */
async function unsetSecret(ctx, { target, name: key }) {
  const input = { ...targetIds({ ctx, target }), name: name({ ctx, value: key }) };
  const data = await gql(ctx, { query: QUERIES.unset, variables: { input } });
  if (data.variableDelete !== true) ctx.fail("Railway did not confirm the variable removal. Check the provider console before retrying.");
  return {};
}
const secretCapabilities = { appliesOn: "next-deploy", supportsStaging: true };
export default { listTargets, deploy, status, logs, secretCapabilities, listSecrets, setSecret, unsetSecret };
