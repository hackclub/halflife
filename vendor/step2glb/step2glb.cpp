#include <BRepBndLib.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <Bnd_Box.hxx>
#include <IGESCAFControl_Reader.hxx>
#include <Interface_Static.hxx>
#include <Message_ProgressRange.hxx>
#include <RWGltf_CafWriter.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <Standard_Version.hxx>
#include <StepData_StepModel.hxx>
#include <StepGeom_Curve.hxx>
#include <StepGeom_Line.hxx>
#include <StepGeom_Plane.hxx>
#include <StepGeom_Surface.hxx>
#include <StepShape_FaceSurface.hxx>
#include <TColStd_IndexedDataMapOfStringString.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDocStd_Document.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#if OCC_VERSION_HEX >= 0x070800
#include <DESTEP_Parameters.hxx>
#endif

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>

static void say(const char* message) {
  std::printf("%s\n", message);
  std::fflush(stdout);
}

static std::string extensionOf(const std::string& path) {
  const size_t dot = path.find_last_of('.');
  std::string ext = dot == std::string::npos ? "" : path.substr(dot + 1);
  std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) { return std::tolower(c); });
  return ext;
}

// Meshes exported as STEP (thousands of flat triangles) make OpenCascade's face
// orientation fix quadratic in the number of faces, so those files skip that one step.
static bool isFaceted(const Handle(StepData_StepModel)& model) {
  int faces = 0;
  for (Standard_Integer i = 1; i <= model->NbEntities(); i++) {
    const Handle(Standard_Transient)& entity = model->Value(i);
    if (entity->IsKind(STANDARD_TYPE(StepShape_FaceSurface))) faces++;
    else if (entity->IsKind(STANDARD_TYPE(StepGeom_Surface)) && !entity->IsKind(STANDARD_TYPE(StepGeom_Plane))) return false;
    else if (entity->IsKind(STANDARD_TYPE(StepGeom_Curve)) && !entity->IsKind(STANDARD_TYPE(StepGeom_Line))) return false;
  }
  return faces >= 2000;
}

static void skipFaceOrientation(STEPCAFControl_Reader& reader, const std::string& dir) {
#if OCC_VERSION_HEX >= 0x070800
  (void)dir;
  DE_ShapeFixParameters parameters = DESTEP_Parameters::GetDefaultShapeFixParameters();
  parameters.FixFaceOrientationMode = DE_ShapeFixParameters::FixMode::NotFix;
  reader.ChangeReader().SetShapeFixParameters(parameters);
#else
  // Older versions only take shape fixing settings from a resource file.
  (void)reader;
  std::ofstream(dir + "/Faceted") << "Faceted.exec.op : FixShape\n"
                                     "Faceted.FixShape.Tolerance3d : &Runtime.Tolerance\n"
                                     "Faceted.FixShape.MaxTolerance3d : &Runtime.MaxTolerance\n"
                                     "Faceted.FixShape.MinTolerance3d : 1.e-7\n"
                                     "Faceted.FixShape.FixFaceOrientationMode : 0\n";
  setenv("CSF_FacetedDefaults", dir.c_str(), 1);
  Interface_Static::SetCVal("read.step.resource.name", "Faceted");
  Interface_Static::SetCVal("read.step.sequence", "Faceted");
#endif
}

static bool read(const std::string& path, Handle(TDocStd_Document) doc) {
  const std::string ext = extensionOf(path);
  if (ext == "step" || ext == "stp") {
    STEPCAFControl_Reader reader;
    reader.SetColorMode(true);
    reader.SetNameMode(true);
    reader.SetLayerMode(false);
    if (reader.ReadFile(path.c_str()) != IFSelect_RetDone) return false;
    const size_t slash = path.find_last_of('/');
    if (isFaceted(reader.ChangeReader().StepModel()))
      skipFaceOrientation(reader, slash == std::string::npos ? "." : path.substr(0, slash));
    return reader.Transfer(doc);
  }
  if (ext == "iges" || ext == "igs") {
    IGESCAFControl_Reader reader;
    reader.SetColorMode(true);
    reader.SetNameMode(true);
    return reader.ReadFile(path.c_str()) == IFSelect_RetDone && reader.Transfer(doc);
  }
  if (ext == "brep" || ext == "brp") {
    TopoDS_Shape shape;
    BRep_Builder builder;
    if (!BRepTools::Read(shape, path.c_str(), builder) || shape.IsNull()) return false;
    XCAFDoc_DocumentTool::ShapeTool(doc->Main())->AddShape(shape);
    return true;
  }
  return false;
}

static int mesh(const Handle(TDocStd_Document)& doc) {
  TDF_LabelSequence roots;
  XCAFDoc_DocumentTool::ShapeTool(doc->Main())->GetFreeShapes(roots);
  Bnd_Box box;
  for (Standard_Integer i = 1; i <= roots.Length(); i++) BRepBndLib::Add(XCAFDoc_ShapeTool::GetShape(roots.Value(i)), box);
  if (box.IsVoid()) return 0;
  const double size = std::sqrt(box.SquareExtent());
  const double deflection = std::clamp(size * 0.0005, 0.01, 2.0);

  int solids = 0;
  for (Standard_Integer i = 1; i <= roots.Length(); i++) {
    const TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(roots.Value(i));
    for (TopExp_Explorer it(shape, TopAbs_SOLID); it.More(); it.Next()) {
      BRepMesh_IncrementalMesh(it.Current(), deflection, false, 0.5, false);
      if (++solids % 100 == 0) std::printf("Meshed %d solids\n", solids), std::fflush(stdout);
    }
    for (TopExp_Explorer it(shape, TopAbs_FACE, TopAbs_SOLID); it.More(); it.Next())
      BRepMesh_IncrementalMesh(it.Current(), deflection, false, 0.5, false);
  }
  return solids;
}

int main(int argc, char** argv) {
  if (argc != 3) {
    std::fprintf(stderr, "usage: step2glb <model.step|.iges|.brep> <out.glb>\n");
    return 2;
  }
  Handle(XCAFApp_Application) app = XCAFApp_Application::GetApplication();
  Handle(TDocStd_Document) doc;
  app->NewDocument("BinXCAF", doc);

  say("Reading the model");
  if (!read(argv[1], doc)) {
    std::fprintf(stderr, "OpenCascade could not read this file.\n");
    return 3;
  }

  say("Meshing solids");
  mesh(doc);
  XCAFDoc_DocumentTool::SetLengthUnit(doc, 1.0);

  say("Writing the model");
  RWGltf_CafWriter writer(argv[2], true);
  writer.SetTransformationFormat(RWGltf_WriterTrsfFormat_Compact);
  writer.SetMergeFaces(true);
  writer.ChangeCoordinateSystemConverter().SetInputCoordinateSystem(RWMesh_CoordinateSystem_Zup);
  TColStd_IndexedDataMapOfStringString metadata;
  if (!writer.Perform(doc, metadata, Message_ProgressRange())) {
    std::fprintf(stderr, "The converted model could not be written.\n");
    return 4;
  }
  say("Done");
  return 0;
}
