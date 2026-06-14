import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { ResearchActivityDataPoint } from "../../types/dashboard.types";

interface ResearchActivityCardProps {
  data: ResearchActivityDataPoint[];
}

export const ResearchActivityCard: React.FC<ResearchActivityCardProps> = ({ data }) => {
  return (
    <div className="bg-bg-surface border border-border-default rounded-xl p-5 flex flex-col h-[380px] w-full transition-all duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
        <div>
          <h3 className="text-base font-semibold text-text-primary">Research Activity</h3>
          <p className="text-[12px] text-text-muted mt-0.5">Overview of resources analyzed and key takeaways generated</p>
        </div>
        
        {/* Legend Indicator info */}
        <div className="flex items-center gap-4 text-[12px] font-medium mt-1 sm:mt-0">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-accent-primary block" />
            <span className="text-text-secondary">Sources Reviewed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-success block" />
            <span className="text-text-secondary">Notes Created</span>
          </div>
        </div>
      </div>

      <div className="flex-1 w-full text-[11px]">
        {/* Recharts responsive component */}
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
          >
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="var(--border-subtle)" 
              vertical={false}
            />
            <XAxis 
              dataKey="day" 
              stroke="var(--text-muted)"
              tickLine={false}
              axisLine={false}
              dy={10}
            />
            <YAxis 
              stroke="var(--text-muted)"
              tickLine={false}
              axisLine={false}
              dx={-5}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-bg-elevated border border-border-default rounded-lg p-3 shadow-lg text-[12px] space-y-1.5">
                      <p className="font-semibold text-text-primary">{label}</p>
                      {payload.map((entry, index) => (
                        <div key={index} className="flex items-center justify-between gap-6">
                          <span className="text-text-secondary flex items-center gap-1.5">
                            <span 
                              className="w-1.5 h-1.5 rounded-full block" 
                              style={{ backgroundColor: entry.color }}
                            />
                            {entry.name}
                          </span>
                          <span className="font-bold text-text-primary">{entry.value}</span>
                        </div>
                      ))}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Line
              name="Sources Reviewed"
              type="monotone"
              dataKey="sourcesReviewed"
              stroke="var(--accent-primary)"
              strokeWidth={2.5}
              dot={{ r: 4, strokeWidth: 1.5, fill: "var(--bg-surface)" }}
              activeDot={{ r: 6, strokeWidth: 0, fill: "var(--accent-primary)" }}
            />
            <Line
              name="Notes Created"
              type="monotone"
              dataKey="notesCreated"
              stroke="var(--success)"
              strokeWidth={2.5}
              dot={{ r: 4, strokeWidth: 1.5, fill: "var(--bg-surface)" }}
              activeDot={{ r: 6, strokeWidth: 0, fill: "var(--success)" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
