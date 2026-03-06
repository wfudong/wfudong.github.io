a[t_] := {Cos[t], Sin[2 t], t/2};
b[t_] := {t^2, Exp[-t/3], Sin[t]};

labelStyle = Directive[Black, 24];
tickStyle = Directive[Black, 18];
legendStyle = Directive[Black, 18];
titleStyle = Directive[Black, 24, Bold];

lhs[t_] := (D[a[s].b[s], s] /. s -> t);
rhs[t_] := ((D[a[s], s] /. s -> t).b[t]) + (a[t].(D[b[s], s] /. s -> t));
diff[t_] := lhs[t] - rhs[t];
p1 = Plot[{lhs[t], rhs[t]}, {t, 0, 6},
	PlotStyle -> {Directive[Blue, Thick], Directive[Red, Dashed, Thick]},
	PlotLegends -> Placed[LineLegend[{"d/dt (a(t) . b(t))", "a'(t) . b(t) + a(t) . b'(t)"}, LabelStyle -> legendStyle], Above],
	AxesLabel -> {"t", "value"},
	PlotLabel -> Style["Problem 3 Verification: Dot-Product Rule", titleStyle],
	LabelStyle -> labelStyle,
	TicksStyle -> tickStyle,
	ImageSize -> 1300,
	GridLines -> Automatic
];
p2 = Plot[diff[t], {t, 0, 6},
	PlotStyle -> {Directive[Darker[Green], Thick]},
	AxesLabel -> {"t", "difference"},
	PlotLabel -> Style["Difference (should be 0)", titleStyle],
	LabelStyle -> labelStyle,
	TicksStyle -> tickStyle,
	ImageSize -> 1300,
	GridLines -> Automatic
];
final = GraphicsGrid[{{p1}, {p2}}, Spacings -> {0.2, 0.35}, ImageSize -> 1500];
Export["wfudong.github.io/teaching-site/assets/lecture-2/problem3_dot_product_rule.png", final, ImageResolution -> 220]
