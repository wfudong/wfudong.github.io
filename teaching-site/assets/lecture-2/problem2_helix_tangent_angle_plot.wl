R = 2;
b = 1;

labelStyle = Directive[Black, 24];
tickStyle = Directive[Black, 18];
legendStyle = Directive[Black, 18];
titleStyle = Directive[Black, 24, Bold];

r[t_] := {R Cos[t], R Sin[t], b t};
T[t_] := D[r[s], s] /. s -> t;
unitT[t_] := T[t]/Sqrt[T[t].T[t]];

theta[t_] := ArcCos[unitT[t].{0, 0, 1}];

helixPlot = ParametricPlot3D[r[t], {t, 0, 2 Pi},
  PlotStyle -> {Directive[Blue, Thick]},
  AxesLabel -> {"x", "y", "z"},
  PlotLabel -> Style["Helix and Tangent Directions", titleStyle],
  LabelStyle -> labelStyle,
  TicksStyle -> tickStyle,
  ImageSize -> 1300,
  BoxRatios -> {1, 1, 0.8}
];

sampleTs = Range[0, 2 Pi, Pi/3];
tangentGraphics = Graphics3D[
  Table[
    {Red, Thick, Arrow[{r[t0], r[t0] + 0.65 unitT[t0]}]},
    {t0, sampleTs}
  ]
];

p1 = Show[helixPlot, tangentGraphics];

constantAngle = N[ArcCos[b/Sqrt[R^2 + b^2]]];
p2 = Plot[{theta[t], constantAngle}, {t, 0, 2 Pi},
  PlotStyle -> {Directive[Darker[Green], Thick], Directive[Black, Dashed]},
  PlotLegends -> Placed[LineLegend[{"theta(t) = angle(T(t), z-axis)", "ArcCos[b/Sqrt[R^2+b^2]]"}, LabelStyle -> legendStyle], Above],
  AxesLabel -> {"t", "angle (rad)"},
  PlotLabel -> Style["Angle with z-axis is Constant", titleStyle],
  LabelStyle -> labelStyle,
  TicksStyle -> tickStyle,
  ImageSize -> 1300,
  GridLines -> Automatic
];

final = GraphicsGrid[{{p1}, {p2}}, Spacings -> {0.2, 0.35}, ImageSize -> 1500];

Export["wfudong.github.io/teaching-site/assets/lecture-2/problem2_helix_tangent_angle.png", final, ImageResolution -> 220]
