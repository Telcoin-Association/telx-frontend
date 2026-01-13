import React from "react";
import {
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart, Bar,
  CartesianGrid,
  CartesianAxis,
} from "recharts";

// note from Akhil: we will not be using '@tremor/react' anymore. it does not support react 19, and conflicts with our npm. Instead we should be using Tremor Raw (tremor's copy-paste components).
// more info: https://tremor.so/docs/getting-started/installation/next
// more info: https://tremor.so/docs/visualizations/area-chart

interface ChartProps {
  weights: number[];
  labels: string[];
  chartLabel: string;
  selectedDays: number;
}

export default function PoolChart(props: ChartProps) {
  const { weights, labels, chartLabel, selectedDays } = props;
  const reversedLabels = [...labels].reverse();
  const diff = weights.length - selectedDays;
  const slicedWeights = weights.slice(diff, weights.length);
  const slicedLabels = reversedLabels.slice(diff, labels.length);

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      console.error(`Invalid date string after ISO: ${date}`);
      return dateString;
    }
    // Use Intl.DateTimeFormat to format the date according to the user's locale
    const formatter = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    });
    return formatter.format(date);
  };

  const chartdata = slicedLabels.map((label, index) => ({
    date: formatDate(label),
    // totalLiquidity: slicedWeights[index],
    [chartLabel]: slicedWeights[index],
  }));

  const valueFormatter = (number: number) => {
    return "$" + Intl.NumberFormat("en-US").format(number);
  };

  return (
    <div className="">
      <div className="hidden md:block">
        <ResponsiveContainer width="100%" height={480}>
          <BarChart height={40} data={chartdata}>
            <CartesianGrid strokeDasharray="0" vertical={false} strokeOpacity={0.2} />
            <XAxis
              dataKey="date"
              tick={{ fill: "#C9CFED" }}
              axisLine={false}
              tickLine={false}
              fontSize={12}
            />
            <YAxis
              tick={{ fill: "#C9CFED" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => value.toLocaleString()}
              width={80}
              fontSize={12}
            />
            <Tooltip
              contentStyle={{
                background: "linear-gradient(255.96deg, #3057A6 0%, #19245d 100%)",
                boxShadow: "0px 10px 18px rgba(0, 0, 0, 1)",
                borderRadius: "8px",
                border: "none",
                color: "white",
              }}
              itemStyle={{ color: "white" }}
              formatter={(value) => valueFormatter(value as number)}
            />
            <Bar dataKey={chartLabel} fill="#4967FF" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="md:hidden">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart height={40} data={chartdata}>
            {/* <CartesianGrid strokeDasharray="3 3" /> */}
            <CartesianAxis />
            <XAxis
              dataKey="date"
              tick={{ fill: "#C9CFED" }}
              axisLine={false}
              tickLine={false}
              fontSize={12}
            />
            <YAxis
              tick={{ fill: "#C9CFED" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => value.toLocaleString()}
              width={60}
              fontSize={12}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#fff",
                boxShadow: "0px 4px 8px rgba(0, 0, 0, 0.1)",
                borderRadius: "8px",
                border: "none",
              }}
              itemStyle={{ color: "black" }}
              formatter={(value) => valueFormatter(value as number)}
            />
            <Bar dataKey={chartLabel} fill="#4967FF" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>

  );
}
