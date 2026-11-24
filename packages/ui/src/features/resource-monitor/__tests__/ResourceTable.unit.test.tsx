// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResourceTable, type ResourceTableFormat, type ResourceTableGroup, type ResourceTableLabels } from "../ResourceTable.js";

type Metrics = { rssBytes: number | null; cpuPercent: number | null; memoryMetric?: "exact" | "rough"; hot?: boolean };
type Row = { pid: number; name: string; role: "server" | "plain"; rssBytes: number; cpuPercent: number | null; memoryMetric?: "exact" | "rough" };

const labels: ResourceTableLabels = { caption: "Usage", process: "Proc", pid: "Id", memory: "Mem", cpu: "Load", actions: "Do", unavailable: "unknown" };
const format: ResourceTableFormat<Metrics, Row> = {
  memory: ({ bytes, reading }) => `${bytes}B${reading.memoryMetric === "rough" ? "?" : ""}`,
  cpu: ({ percent }) => `${percent}pct`,
  warning: ({ metrics }) => (metrics?.hot ? "Hot" : ""),
  role: ({ role }) => (role === "server" ? "Server" : ""),
};
const groups: ResourceTableGroup<Metrics, Row>[] = [
  { id: "host", title: "Host", metrics: { rssBytes: null, cpuPercent: null }, processes: [{ pid: 1, name: "main", role: "plain", rssBytes: 10, cpuPercent: 0 }], stop: null },
  { id: "a", title: "Alpha", metrics: { rssBytes: 20, cpuPercent: 3, memoryMetric: "rough", hot: true },
    processes: [{ pid: 7, name: "node", role: "server", rssBytes: 20, cpuPercent: null, memoryMetric: "rough" }], stop: { label: "Halt", disabled: false } },
  { id: "b", title: "Beta", processes: [], stop: { label: "Halting", disabled: true } },
];

describe("ResourceTable", () => {
  it("renders headings, groups, process rows and the host's formatting, never a zero for an unknown reading", () => {
    const { container } = render(<ResourceTable groups={groups} onStop={() => {}} labels={labels} format={format} classNames={{ visuallyHidden: "sr" }} />);
    expect(container.querySelector("caption")?.className).toBe("jini-resources-table__hidden sr");
    expect(container.querySelector("caption")?.textContent).toBe("Usage");
    expect([...container.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual(["Proc", "Id", "Mem", "Load", "Do"]);
    const bodies = [...container.querySelectorAll("tbody")];
    expect(bodies).toHaveLength(3);
    const hostCells = [...bodies[0]!.querySelectorAll(".jini-resources-table__group td.jini-resources-table__num")].map((cell) => cell.textContent);
    expect(hostCells).toEqual(["—unknown", "—unknown"]);
    expect(bodies[0]!.querySelector(".jini-resources-table__hidden")?.className).toBe("jini-resources-table__hidden sr");
    expect(bodies[0]!.querySelector(".jini-resources-table__action button")).toBe(null);
    expect(bodies[0]!.querySelector(".jini-resources-table__role")).toBe(null);
    expect(bodies[1]!.querySelector("th")?.textContent).toBe("Alpha · Hot");
    expect([...bodies[1]!.querySelectorAll(".jini-resources-table__group td.jini-resources-table__num")].map((cell) => cell.textContent)).toEqual(["20B?", "3pct"]);
    const processRow = bodies[1]!.querySelectorAll("tr")[1]!;
    expect(processRow.querySelector(".jini-resources-table__process")?.textContent).toBe("nodeServer");
    expect([...processRow.querySelectorAll("td.jini-resources-table__num")].map((cell) => cell.textContent)).toEqual(["7", "20B?", "—unknown"]);
    expect(bodies[2]!.querySelector("th")?.textContent).toBe("Beta");
    expect((bodies[2]!.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Stop hands the group's id to the host and nothing else", () => {
    const stopped: string[] = [];
    const view = render(<ResourceTable groups={groups} onStop={({ id }) => { stopped.push(id); }} labels={labels} format={format} />);
    fireEvent.click(view.getByRole("button", { name: "Halt" }));
    expect(stopped).toEqual(["a"]);
    expect(view.container.querySelector("caption")?.className).toBe("jini-resources-table__hidden");
  });
});
