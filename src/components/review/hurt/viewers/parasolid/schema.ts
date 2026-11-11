// Effective fields of each node type in Parasolid's base transmit schema (SCH_13006), which embedded
// schemas in XT files are written against. Each field is name:type, with ! for fields that are not
// transmitted, * for variable-length fields and a number for fixed arrays.
export const BASE_SCHEMA = `
1 NULLP 
2 WORKSPACE ws:c*
3 PARTITION current_pmark:p highest_id:d
4 PMARK preceding:p first_following:p next_sibling:p prev_sibling:p n_new_nodes:d n_del_nodes:d n_copy_mod_nodes:d delta_key:d delta_is_forward:l id:d
10 ASSEMBLY highest_node_id:d attributes_features:p attribute_chains:p list:p surface:p curve:p point:p key:p res_size:f res_linear:f ref_instance:p next:p previous:p state:u owner:p type:u sub_instance:p
11 INSTANCE node_id:d attributes_features:p type:u part:p transform:p assembly:p next_in_part:p prev_in_part:p next_of_part:p prev_of_part:p
12 BODY highest_node_id:d attributes_features:p attribute_chains:p surface:p curve:p point:p key:p res_size:f res_linear:f ref_instance:p next:p previous:p state:u owner:p body_type:u nom_geom_state:u shell:p boundary_surface:p boundary_curve:p boundary_point:p region:p edge:p vertex:p
13 SHELL node_id:d attributes_features:p body:p next:p face:p edge:p vertex:p region:p front_face:p
14 FACE node_id:d attributes_features:p tolerance:f next:p previous:p loop:p shell:p surface:p sense:c next_on_surface:p previous_on_surface:p next_front:p previous_front:p front_shell:p
15 LOOP node_id:d attributes_features:p halfedge:p face:p next:p
16 EDGE node_id:d attributes_features:p tolerance:f halfedge:p previous:p next:p curve:p next_on_curve:p previous_on_curve:p owner:p
17 HALFEDGE attributes_features:p loop:p forward:p backward:p vertex:p other:p edge:p curve:p next_at_vx:p sense:c
18 VERTEX node_id:d attributes_features:p halfedge:p previous:p next:p point:p tolerance:f owner:p
19 REGION node_id:d attributes_features:p body:p next:p previous:p shell:p type:c
29 POINT node_id:d attributes_features:p owner:p next:p previous:p pvec:v
30 LINE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c pvec:v direction:v
31 CIRCLE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c centre:v normal:v x_axis:v radius:f
32 ELLIPSE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c centre:v normal:v x_axis:v major_radius:f minor_radius:f
33 PARABOLA node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c origin:v normal:v x_axis:v focal_length:f
34 HYPERBOLA node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c origin:v normal:v x_axis:v transverse_radius:f conjugate_radius:f
35 PARACURVE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c seg:d cpc:p
36 OBSOLETE_CPC node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c vertex_dimension:n segment_count:n order:n segment:p*
37 PATCH_BOUND node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c boundary:c lh_patch:p rh_patch:p
38 INTERSECTION node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c surface:p2 chart:p start:p end:p
39 SILHOUETTE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c analytic_root:c from_infinity:l surface:p start:p end:p eye:v
40 CHART base_parameter:f base_scale:f chart_count:d chordal_error:f angular_error:f parameter_error:f2 hvec:h*
41 LIMIT type:c hvec:h*
43 BSPLINE_CURVE knot_vector:p vertex_dimension:n vertex_count:d order:n bspline_vertices:p
44 KNOT_VECTOR periodic:l knot_count:d knots:f*
45 BSPLINE_VERTICES vertices:f*
46 OFFSET_CURVE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c surface:p curve:p offset:f
48 CPC node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c bezier:p bspline:p
49 OBSOLETE_SP_CURVE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c const_param:l segment_count:n order:n surface:p bezier_vertices:f*
50 PLANE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c pvec:v normal:v x_axis:v
51 CYLINDER node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c pvec:v axis:v radius:f x_axis:v
52 CONE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c pvec:v axis:v radius:f sin_half_angle:f cos_half_angle:f x_axis:v
53 SPHERE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c centre:v radius:f axis:v x_axis:v
54 TORUS node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c centre:v axis:v major_radius:f minor_radius:f x_axis:v
55 PIPE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c spine:p radius:f
56 BLENDED_EDGE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c blend_type:c surface:p2 spine:p range:f2 thumb_weight:f2 boundary:p2 start:p end:p
57 BLENDED_VERTEX node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c blend_type:c surface:p3 sub_surface:p3 boundary:p3 range:f3 thumb_weight:f3 centre:v
58 BLEND_OVERLAP node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c surface:p2 sub_surface:p4 range:f4 thumb_weight:f4 blend_type:c2 overlap_type:c swap_u_v:l
59 BLEND_BOUND node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c boundary:n blend:p
60 OFFSET_SURF node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c check:c true_offset:l surface:p offset:f scale:f
61 PARASURF node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c col:d row:d cps:p
62 OBSOLETE_CPS node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c vertex_dimension:n col_count:n row_count:n u_order:n v_order:n patch:p*
63 SILH_SURF node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c from_infinity:l surface:p eye:v
66 BSPLINE_SURF row_knots:p col_knots:p vertex_dimension:n col_count:d row_count:d u_order:n v_order:n bspline_vertices:p
67 SWEPT_SURF node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c section:p sweep:v scale:f
68 SPUN_SURF node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c profile:p base:v axis:v start:v end:v start_param:f end_param:f x_axis:v scale:f
69 CPS node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c bezier:p bspline:p
70 LIST node_id:d owner:p next:p previous:p list_type:d list_length:d block_length:d size_of_entry:d list_block:p finger_block:p finger_index:d notransmit:l
74 POINTER_LIS_BLOCK n_entries:d next_block:p entries:p*
79 ATT_DEF_ID string:c*
80 ATTRIB_DEF next:p identifier:p type_id:d actions:u8 field_names:p legal_owners:l14 fields:u*
81 ATTRIBUTE node_id:d definition:p owner:p next:p previous:p next_of_type:p previous_of_type:p fields:p*
82 INT_VALUES values:d*
83 REAL_VALUES values:f*
84 CHAR_VALUES values:c*
85 POINT_VALUES values:v*
86 VECTOR_VALUES values:v*
87 AXIS_VALUES values:v*
88 TAG_VALUES values:t*
89 DIRECTION_VALUES values:v*
90 FEATURE node_id:d attributes_features:p owner:p next:p previous:p type:u first_member:p
91 MEMBER_OF_FEATURE dummy_node_id:d owning_feature:p owner:p next:p previous:p next_member:p previous_member:p
96 SHORT_VALUES values:n*
97 BOX_VALUES values:b*
98 UNICODE_VALUES values:w*
99 FIELD_NAMES names:p*
100 TRANSFORM node_id:d owner:p next:p previous:p rotation_matrix:f9 translation_vector:v scale:f flag:d perspective_vector:v
101 WORLD assembly:p attribute:p body:p transform:p surface:p curve:p point:p alive:l attrib_def:p highest_id:d current_id:d
102 KEY string:c*
103 BEZIER_CURVE vertex_dimension:n segment_count:d order:n check:c segment:p*
104 BEZIER_SURF vertex_dimension:n col_count:d row_count:d u_order:n v_order:n check:c patch:p*
110 SET_ELEMENT_TAG next:p forward:p backward:p class:d set:p node:p
111 FACE_SET tag:p next:p class:d he_set:p surfaces:p
112 HALFEDGE_SET tag:p next:p previous:p class:d fa_set:p co_he_set:p
120 PE_SURF node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c type:c data:p tf:p internal_geom:p*
121 INT_PE_DATA geom_type:d real_array:p int_array:p
122 EXT_PE_DATA key:p real_array:p int_array:p data:f!*
124 B_SURFACE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c nurbs:p data:p
125 SURFACE_DATA original_uint:i original_vint:i extended_uint:i extended_vint:i self_int:u original_u_start:c original_u_end:c original_v_start:c original_v_end:c extended_u_start:c extended_u_end:c extended_v_start:c extended_v_end:c analytic_form_type:c swept_form_type:c spun_form_type:c blend_form_type:c analytic_form:p swept_form:p spun_form:p blend_form:p
126 NURBS_SURF u_periodic:l v_periodic:l u_degree:n v_degree:n n_u_vertices:d n_v_vertices:d u_knot_type:u v_knot_type:u n_u_knots:d n_v_knots:d rational:l u_closed:l v_closed:l surface_form:u vertex_dim:n bspline_vertices:p u_knot_mult:p v_knot_mult:p u_knots:p v_knots:p
127 KNOT_MULT mult:n*
128 KNOT_SET knots:f*
130 PE_CURVE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c type:c data:p tf:p internal_geom:p*
132 PCURVE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c bsp_parms:l surface:p bspline:p
133 TRIMMED_CURVE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c basis_curve:p point_1:v point_2:v parm_1:f parm_2:f
134 B_CURVE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c nurbs:p data:p
135 CURVE_DATA self_int:u analytic_form:p
136 NURBS_CURVE degree:n n_vertices:d vertex_dim:n n_knots:d knot_type:u periodic:l closed:l rational:l curve_form:u bspline_vertices:p knot_mult:p knots:p
137 SP_CURVE node_id:d attributes_features:p owner:p next:p previous:p geometric_owner:p sense:c surface:p b_curve:p original:p tolerance_to_original:f
141 GEOMETRIC_OWNER owner:p next:p previous:p shared_geometry:p
150 PLANE_FORM pvec:v normal:v
151 CYLINDER_FORM pvec:v axis:v radius:f sense:c
152 CONE_FORM pvec:v axis:v radius:f sin_half_angle:f cos_half_angle:f sense:c
153 SPHERE_FORM centre:v radius:f sense:c
154 TORUS_FORM centre:v axis:v major_radius:f minor_radius:f sense:c
155 SWEPT_FORM sweep:v subtype:c
156 SWEPT_UV_FORM sweep_u:v sweep_v:v subtype_u:c subtype_v:c
157 SPUN_FORM base:v axis:v subtype:c
158 VAR_RADIUS_PIPE_FORM max_radius:f min_radius:f max_radius_bdry:c min_radius_bdry:c
163 HELIX_SU_FORM axis_pt:v axis_dir:v hand:c turns:i pitch:f gap:f tol:f
184 HELIX_CU_FORM axis_pt:v axis_dir:v point:v hand:c turns:i pitch:f tol:f
`
