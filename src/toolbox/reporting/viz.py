import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.graph_objs import Figure


def stylize(fig: Figure, slant: bool=False, **kwargs):
    y_gap = kwargs.get('gap', None)
    group_gap = kwargs.get('group_gap', None)
    x_title = kwargs.get('x_label', None)
    y_title = kwargs.get('y_label', None)
    width = kwargs.get('width', None)

    fig.update_layout(
        plot_bgcolor='white',
        paper_bgcolor='white',
        xaxis_title=x_title,
        yaxis_title=y_title,
        # yaxis_visible=False, # This makes the y-axis line, ticks, and gridlines invisible
        yaxis_showticklabels=False,
        bargap=y_gap,
        bargroupgap=group_gap,
        legend=dict(
            title=None,
            orientation="h",  # Horizontal orientation for the legend items
            yanchor="bottom", # Anchor the legend to the bottom of the figure
            y=-0.3,           # Position the legend below the plot area (adjust as needed)
            xanchor="center", # Center the legend horizontally
            x=0.5             # Position the legend at the horizontal center of the figure
        ),
        xaxis = dict(
            tickangle=-45 if slant else 0
        )
    )

    if width:
        fig.update_traces(width=width)

    for trace in fig.data:
        if isinstance(trace, go.Bar):
            trace.update(
                texttemplate='%{y:,.0f}',
                textposition='outside',
                textfont=dict(size=11, family='Arial Black')
            )

    return fig


def prepare_proportions(data: pd.DataFrame, columns: list) -> pd.DataFrame:
    data['total'] = data[columns].sum(axis=1, numeric_only=True)
    for col in columns:
        data[f'{col}_prop'] = data[col] / data['total']

    return data


def make_stacked_bar_chart(dataset: pd.DataFrame, features: list, color_scheme: dict, label_col: str) -> Figure:
    fig = go.Figure()
    dataset = prepare_proportions(dataset, features)

    for i, feature in enumerate(features):
        fig.add_trace(go.Bar(
            y=dataset[label_col],
            x=dataset[f'{feature}_prop'],
            name=feature,
            orientation='h',
            text=[f'{val}' for val in dataset[feature]],
            textposition='inside',
            marker_color=color_scheme[feature]
        ))

    fig.update_layout(
        barmode='stack',
        plot_bgcolor='white',
        paper_bgcolor='white',
        legend=dict(
            title=None,
            orientation="h",
            yanchor="bottom",
            y=-0.3,
            xanchor="center",
            x=0.5,
        ),
        height=800,
        width=1500,
        showlegend=True,
        xaxis=dict(
            tickformat=".0%",
            title=None
        ),
        # order yaxis categories in reverse order
        yaxis=dict(autorange="reversed"),
        legend_traceorder="reversed"

    )

    return fig


def make_bar_chart(
        dataset: pd.DataFrame, x_field: str, y_fields: str|list, color_scheme: dict[str, str], **kwargs) -> Figure:

    bar_mode = kwargs.get('barmode', 'relative')
    color = kwargs.get('color', None)
    width = kwargs.get('width', None)
    text_auto = kwargs.get('text', False)
    axis_labels = kwargs.get('axis_labels', None)
    chart_title = kwargs.get('title', None)


    return px.bar(
       data_frame=dataset,
        x=x_field,
        y=y_fields,
        color_discrete_map=color_scheme,
        barmode=bar_mode,
        color=color,
        width=width,
        text_auto=text_auto,
        labels=axis_labels,
        title=chart_title
    )


def make_pie_chart(
        data: pd.DataFrame, visitation_field: str, values_field: str, color_scheme: dict, **kwargs) -> Figure:

    color = kwargs.get('color', None)
    donut_hole = kwargs.get('hole', None)

    return px.pie(
        data_frame=data,
        names=visitation_field,
        values=values_field,
        color_discrete_map=color_scheme,
        color=color,
        hole=donut_hole
    )
