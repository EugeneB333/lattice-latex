use base64::Engine as _;
use regex::Regex;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env, fs,
    path::{Component, Path, PathBuf},
    process::Stdio,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use tokio::{
    io::{self, AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    time::{timeout, Duration},
};

const MAX_EDITABLE_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_AI_SOURCE_CHARS: usize = 120_000;
const BUILD_TIMEOUT_SECONDS: u64 = 90;
const LIVE_BUILD_TIMEOUT_SECONDS: u64 = 30;
const PDF_PAGE_RENDER_TIMEOUT_SECONDS: u64 = 10;
const MAX_PDF_PAGE_SVG_BYTES: usize = 32 * 1024 * 1024;
const STARTER_SOURCE: &str = include_str!("../../assets/starter.tex");

#[derive(Debug, Error)]
enum LatticeError {
    #[error("{0}")]
    Message(String),
    #[error("File operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("AI service request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("The service returned invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
}

type Result<T> = std::result::Result<T, LatticeError>;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum EngineId {
    PdfLatex,
    XeLatex,
    LuaLatex,
}

impl EngineId {
    fn executable(self) -> &'static str {
        match self {
            Self::PdfLatex => "pdflatex",
            Self::XeLatex => "xelatex",
            Self::LuaLatex => "lualatex",
        }
    }

    fn latexmk_flag(self) -> &'static str {
        match self {
            Self::PdfLatex => "-pdf",
            Self::XeLatex => "-xelatex",
            Self::LuaLatex => "-lualatex",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineInfo {
    id: EngineId,
    label: &'static str,
    available: bool,
    path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFile {
    path: String,
    name: String,
    kind: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSnapshot {
    root: String,
    name: String,
    root_document: String,
    files: Vec<ProjectFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Severity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Diagnostic {
    severity: Severity,
    file: Option<String>,
    line: Option<u32>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildResult {
    success: bool,
    duration_ms: u128,
    engine: EngineId,
    diagnostics: Vec<Diagnostic>,
    log: String,
    pdf_base64: Option<String>,
    pdf_version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfPageImage {
    svg_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncTexPdfPosition {
    page: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncTexSourcePosition {
    path: String,
    line: u32,
    column: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectionRange {
    start_line: u32,
    start_column: u32,
    end_line: u32,
    end_column: u32,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiRequest {
    root: String,
    path: String,
    source: String,
    prompt: String,
    selection: Option<SelectionRange>,
    diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiProposal {
    summary: String,
    explanation: String,
    replacement: String,
    mode: String,
}

#[derive(Deserialize)]
struct RpcRequest {
    id: u64,
    command: String,
    #[serde(default)]
    args: Value,
}

#[derive(Serialize)]
struct RpcResponse {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Deserialize)]
struct RootArgs {
    root: String,
}

#[derive(Deserialize)]
struct ReadFileArgs {
    root: String,
    path: String,
}

#[derive(Deserialize)]
struct WriteFileArgs {
    root: String,
    path: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompileArgs {
    root: String,
    root_document: String,
    engine: EngineId,
    #[serde(default)]
    background: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderPdfPageArgs {
    root: String,
    root_document: String,
    pdf_version: String,
    page: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForwardSearchArgs {
    root: String,
    root_document: String,
    path: String,
    line: u32,
    column: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InverseSearchArgs {
    root: String,
    root_document: String,
    page: u32,
    x: f64,
    y: f64,
}

#[derive(Deserialize)]
struct AiArgs {
    request: AiRequest,
}

fn decode_args<T: DeserializeOwned>(value: Value) -> Result<T> {
    Ok(serde_json::from_value(value)?)
}

fn find_on_path(executable: &str) -> Option<String> {
    let paths = env::var_os("PATH")?;
    env::split_paths(&paths)
        .map(|directory| directory.join(executable))
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().into_owned())
}

fn detect_engines() -> Vec<EngineInfo> {
    [
        (EngineId::PdfLatex, "pdfLaTeX"),
        (EngineId::XeLatex, "XeLaTeX"),
        (EngineId::LuaLatex, "LuaLaTeX"),
    ]
    .into_iter()
    .map(|(id, label)| {
        let path = find_on_path(id.executable());
        EngineInfo {
            id,
            label,
            available: path.is_some(),
            path,
        }
    })
    .collect()
}

fn read_project(root: String) -> Result<ProjectSnapshot> {
    snapshot_project(Path::new(&root))
}

fn ensure_starter_project(root: String) -> Result<ProjectSnapshot> {
    let root = PathBuf::from(root);
    fs::create_dir_all(&root)?;
    let main_document = root.join("main.tex");
    if !main_document.exists() {
        fs::write(main_document, STARTER_SOURCE)?;
    }
    snapshot_project(&root)
}

fn snapshot_project(root: &Path) -> Result<ProjectSnapshot> {
    let root = root.canonicalize()?;
    if !root.is_dir() {
        return Err(LatticeError::Message(
            "The selected path is not a directory".into(),
        ));
    }
    let mut files = Vec::new();
    collect_project_files(&root, &root, 0, &mut files)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let root_document = detect_root_document(&root, &files)
        .ok_or_else(|| LatticeError::Message("No .tex document was found in this folder".into()))?;
    Ok(ProjectSnapshot {
        name: root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("LaTeX project")
            .to_owned(),
        root: root.to_string_lossy().into_owned(),
        root_document,
        files,
    })
}

fn collect_project_files(
    root: &Path,
    directory: &Path,
    depth: usize,
    result: &mut Vec<ProjectFile>,
) -> Result<()> {
    if depth > 8 {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || matches!(name.as_str(), "node_modules" | "target" | "dist") {
            continue;
        }
        if path.is_dir() {
            collect_project_files(root, &path, depth + 1, result)?;
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let kind = match extension.as_str() {
            "tex" | "sty" | "cls" => "tex",
            "bib" => "bib",
            "png" | "jpg" | "jpeg" | "svg" | "pdf" => "image",
            _ => continue,
        };
        let relative = path
            .strip_prefix(root)
            .map_err(|_| LatticeError::Message("Invalid project path".into()))?;
        result.push(ProjectFile {
            path: relative.to_string_lossy().replace('\\', "/"),
            name,
            kind,
        });
    }
    Ok(())
}

fn detect_root_document(root: &Path, files: &[ProjectFile]) -> Option<String> {
    let candidates = files.iter().filter(|file| file.path.ends_with(".tex"));
    for preferred in ["main.tex", "paper.tex", "thesis.tex"] {
        if let Some(file) = candidates.clone().find(|file| file.path == preferred) {
            return Some(file.path.clone());
        }
    }
    candidates
        .filter(|file| {
            fs::read_to_string(root.join(&file.path))
                .map(|text| text.contains("\\documentclass"))
                .unwrap_or(false)
        })
        .map(|file| file.path.clone())
        .next()
}

fn safe_project_path(
    root: &str,
    relative: &str,
    require_existing: bool,
) -> Result<(PathBuf, PathBuf)> {
    let root = Path::new(root).canonicalize()?;
    let relative_path = Path::new(relative);
    if relative.is_empty()
        || relative_path.is_absolute()
        || relative_path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(LatticeError::Message(
            "Project file paths must be relative and cannot contain traversal components".into(),
        ));
    }
    let joined = root.join(relative_path);
    let resolved = if require_existing {
        joined.canonicalize()?
    } else {
        let parent = joined
            .parent()
            .ok_or_else(|| LatticeError::Message("Invalid file path".into()))?
            .canonicalize()?;
        parent.join(
            joined
                .file_name()
                .ok_or_else(|| LatticeError::Message("Invalid file name".into()))?,
        )
    };
    if !resolved.starts_with(&root) {
        return Err(LatticeError::Message(
            "The requested file is outside the project".into(),
        ));
    }
    Ok((root, resolved))
}

fn read_project_file(root: String, path: String) -> Result<String> {
    let (_, file) = safe_project_path(&root, &path, true)?;
    if file.metadata()?.len() > MAX_EDITABLE_FILE_BYTES {
        return Err(LatticeError::Message(
            "This file is too large to edit safely".into(),
        ));
    }
    Ok(fs::read_to_string(file)?)
}

fn write_project_file(root: String, path: String, content: String) -> Result<()> {
    if content.len() as u64 > MAX_EDITABLE_FILE_BYTES {
        return Err(LatticeError::Message(
            "This file is too large to save safely".into(),
        ));
    }
    let (_, file) = safe_project_path(&root, &path, false)?;
    let extension = file
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "tex" | "bib" | "sty" | "cls") {
        return Err(LatticeError::Message(
            "Lattice only writes LaTeX source and bibliography files".into(),
        ));
    }
    fs::write(file, content)?;
    Ok(())
}

async fn compile_project(
    root: String,
    root_document: String,
    engine: EngineId,
    background: bool,
) -> Result<BuildResult> {
    let (root, source) = safe_project_path(&root, &root_document, true)?;
    if find_on_path(engine.executable()).is_none() {
        return Err(LatticeError::Message(format!(
            "{} is not available on PATH",
            engine.executable()
        )));
    }
    let latexmk = find_on_path("latexmk").ok_or_else(|| {
        LatticeError::Message(
            "latexmk is required. Install it with your TeX Live distribution.".into(),
        )
    })?;

    let output_directory = root.join(".lattice").join("build");
    fs::create_dir_all(&output_directory)?;
    let started = Instant::now();
    let output_argument = format!("-outdir={}", output_directory.to_string_lossy());
    let source_argument = source
        .strip_prefix(&root)
        .unwrap_or(&source)
        .to_string_lossy()
        .into_owned();
    let mut command = background_command(&latexmk, background);
    command
        .current_dir(&root)
        .args([
            engine.latexmk_flag(),
            "-interaction=nonstopmode",
            "-file-line-error",
            "-synctex=1",
            "-halt-on-error",
            "-no-shell-escape",
            &output_argument,
            &source_argument,
        ])
        .env("openout_any", "p")
        .env("shell_escape", "f")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let timeout_seconds = if background {
        LIVE_BUILD_TIMEOUT_SECONDS
    } else {
        BUILD_TIMEOUT_SECONDS
    };
    let output = timeout(Duration::from_secs(timeout_seconds), command.output())
        .await
        .map_err(|_| {
            LatticeError::Message(format!(
                "The {}build exceeded {timeout_seconds} seconds and was stopped",
                if background { "live " } else { "" },
            ))
        })??;
    let mut log = String::from_utf8_lossy(&output.stdout).into_owned();
    if !output.stderr.is_empty() {
        log.push('\n');
        log.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    let diagnostics = parse_diagnostics(&log);
    let pdf_path = output_directory
        .join(source.file_stem().unwrap_or_default())
        .with_extension("pdf");
    let (pdf_base64, pdf_version) = if output.status.success() && pdf_path.is_file() {
        let bytes = fs::read(&pdf_path)?;
        (
            Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
            Some(pdf_file_version(&pdf_path)?),
        )
    } else {
        (None, None)
    };

    Ok(BuildResult {
        success: output.status.success() && pdf_base64.is_some(),
        duration_ms: started.elapsed().as_millis(),
        engine,
        diagnostics,
        log,
        pdf_base64,
        pdf_version,
    })
}

fn background_command(executable: &str, background: bool) -> Command {
    if background {
        if let Some(nice) = find_on_path("nice") {
            let mut command = Command::new(nice);
            command.args(["-n", "10"]).arg(executable);
            return command;
        }
    }
    Command::new(executable)
}

fn pdf_file_version(path: &Path) -> Result<String> {
    let metadata = path.metadata()?;
    let modified = metadata
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    Ok(format!("{}-{modified}", metadata.len()))
}

fn verified_built_pdf(args: &RenderPdfPageArgs) -> Result<(PathBuf, PathBuf)> {
    if args.page == 0 {
        return Err(LatticeError::Message("Invalid PDF page number".into()));
    }
    let (root, source) = safe_project_path(&args.root, &args.root_document, true)?;
    let expected = synctex_output_path(&root, &source);
    let pdf = expected.canonicalize().map_err(|_| {
        LatticeError::Message("Build the document before rendering its preview.".into())
    })?;
    if !pdf.starts_with(&root) {
        return Err(LatticeError::Message(
            "The built PDF is outside the project".into(),
        ));
    }
    if pdf_file_version(&pdf)? != args.pdf_version {
        return Err(LatticeError::Message(
            "The PDF preview is stale; wait for the current build to finish.".into(),
        ));
    }
    Ok((root, pdf))
}

async fn render_pdf_page_with(executable: &str, args: RenderPdfPageArgs) -> Result<PdfPageImage> {
    let (root, pdf) = verified_built_pdf(&args)?;
    let page = args.page.to_string();
    let mut command = Command::new(executable);
    command
        .current_dir(root)
        .args(["-f", &page, "-l", &page, "-svg"])
        .arg(pdf)
        .arg("-")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = timeout(
        Duration::from_secs(PDF_PAGE_RENDER_TIMEOUT_SECONDS),
        command.output(),
    )
    .await
    .map_err(|_| LatticeError::Message("PDF page rendering timed out".into()))??;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(1000)
            .collect::<String>();
        return Err(LatticeError::Message(if detail.trim().is_empty() {
            "Could not render this PDF page".into()
        } else {
            format!("Could not render this PDF page: {}", detail.trim())
        }));
    }
    if output.stdout.len() > MAX_PDF_PAGE_SVG_BYTES {
        return Err(LatticeError::Message(
            "The rendered PDF page is too large to preview safely".into(),
        ));
    }
    if output.stdout.is_empty() || !output.stdout.windows(4).any(|window| window == b"<svg") {
        return Err(LatticeError::Message(
            "The PDF renderer returned an invalid page image".into(),
        ));
    }
    Ok(PdfPageImage {
        svg_base64: base64::engine::general_purpose::STANDARD.encode(output.stdout),
    })
}

async fn render_pdf_page(args: RenderPdfPageArgs) -> Result<PdfPageImage> {
    let executable = find_on_path("pdftocairo").ok_or_else(|| {
        LatticeError::Message(
            "pdftocairo is required for faithful PDF previews. Install Poppler utilities.".into(),
        )
    })?;
    render_pdf_page_with(&executable, args).await
}

fn synctex_value<'a>(output: &'a str, key: &str) -> Option<&'a str> {
    output
        .lines()
        .find_map(|line| {
            line.strip_prefix(key)
                .and_then(|value| value.strip_prefix(':'))
        })
        .map(str::trim)
}

fn parse_synctex_forward(output: &str) -> Result<SyncTexPdfPosition> {
    let parse = |key: &str| -> Result<f64> {
        synctex_value(output, key)
            .ok_or_else(|| LatticeError::Message(format!("SyncTeX returned no {key} coordinate")))?
            .parse::<f64>()
            .map_err(|_| {
                LatticeError::Message(format!("SyncTeX returned an invalid {key} coordinate"))
            })
    };
    let page = synctex_value(output, "Page")
        .ok_or_else(|| LatticeError::Message("SyncTeX found no matching preview position".into()))?
        .parse::<u32>()
        .map_err(|_| LatticeError::Message("SyncTeX returned an invalid page number".into()))?;
    Ok(SyncTexPdfPosition {
        page,
        x: parse("x")?,
        y: parse("y")?,
        width: parse("W").unwrap_or(8.0),
        height: parse("H").unwrap_or(12.0),
    })
}

fn parse_synctex_inverse(output: &str, root: &Path) -> Result<SyncTexSourcePosition> {
    let input = synctex_value(output, "Input")
        .ok_or_else(|| LatticeError::Message("SyncTeX found no matching source position".into()))?;
    let input_path = Path::new(input);
    let resolved = if input_path.is_absolute() {
        input_path.canonicalize()?
    } else {
        root.join(input_path).canonicalize()?
    };
    if !resolved.starts_with(root) {
        return Err(LatticeError::Message(
            "SyncTeX resolved to a source file outside this project".into(),
        ));
    }
    let line = synctex_value(output, "Line")
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| LatticeError::Message("SyncTeX returned an invalid source line".into()))?;
    let column = synctex_value(output, "Column")
        .and_then(|value| value.parse::<i32>().ok())
        .filter(|value| *value > 0)
        .map(|value| value as u32)
        .unwrap_or(1);
    Ok(SyncTexSourcePosition {
        path: resolved
            .strip_prefix(root)
            .map_err(|_| LatticeError::Message("Invalid SyncTeX source path".into()))?
            .to_string_lossy()
            .replace('\\', "/"),
        line,
        column,
    })
}

fn synctex_output_path(root: &Path, source: &Path) -> PathBuf {
    root.join(".lattice")
        .join("build")
        .join(source.file_stem().unwrap_or_default())
        .with_extension("pdf")
}

async fn run_synctex(root: &Path, arguments: &[String]) -> Result<String> {
    if find_on_path("synctex").is_none() {
        return Err(LatticeError::Message(
            "The synctex command is unavailable. Install it with your TeX distribution.".into(),
        ));
    }
    let mut command = Command::new("synctex");
    command
        .current_dir(root)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = timeout(Duration::from_secs(10), command.output())
        .await
        .map_err(|_| LatticeError::Message("SyncTeX navigation timed out".into()))??;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(LatticeError::Message(if detail.is_empty() {
            "SyncTeX could not find a matching position. Rebuild the document and try again.".into()
        } else {
            format!("SyncTeX navigation failed: {detail}")
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

async fn forward_search(args: ForwardSearchArgs) -> Result<SyncTexPdfPosition> {
    let (root, root_source) = safe_project_path(&args.root, &args.root_document, true)?;
    let (_, source) = safe_project_path(&args.root, &args.path, true)?;
    let pdf = synctex_output_path(&root, &root_source);
    if !pdf.is_file() {
        return Err(LatticeError::Message(
            "Build the document before using SyncTeX navigation.".into(),
        ));
    }
    let input = format!(
        "{}:{}:{}",
        args.line.max(1),
        args.column.max(1),
        source.to_string_lossy()
    );
    let output = run_synctex(
        &root,
        &[
            "view".into(),
            "-i".into(),
            input,
            "-o".into(),
            pdf.to_string_lossy().into_owned(),
        ],
    )
    .await?;
    parse_synctex_forward(&output)
}

async fn inverse_search(args: InverseSearchArgs) -> Result<SyncTexSourcePosition> {
    if args.page == 0 || !args.x.is_finite() || !args.y.is_finite() || args.x < 0.0 || args.y < 0.0
    {
        return Err(LatticeError::Message("Invalid preview position".into()));
    }
    let (root, root_source) = safe_project_path(&args.root, &args.root_document, true)?;
    let pdf = synctex_output_path(&root, &root_source);
    if !pdf.is_file() {
        return Err(LatticeError::Message(
            "Build the document before using SyncTeX navigation.".into(),
        ));
    }
    let output_position = format!(
        "{}:{:.6}:{:.6}:{}",
        args.page,
        args.x,
        args.y,
        pdf.to_string_lossy()
    );
    let output = run_synctex(&root, &["edit".into(), "-o".into(), output_position]).await?;
    parse_synctex_inverse(&output, &root)
}

fn parse_diagnostics(log: &str) -> Vec<Diagnostic> {
    let file_line = Regex::new(r"(?m)^(.+?\.(?:tex|sty|cls|bib)):(\d+):\s*(.+)$")
        .expect("valid diagnostic regex");
    let warning =
        Regex::new(r"(?m)^(?:LaTeX|Package \S+) Warning:\s*(.+)$").expect("valid warning regex");
    let mut diagnostics: Vec<Diagnostic> = file_line
        .captures_iter(log)
        .map(|capture| {
            let message = capture[3].trim().to_owned();
            Diagnostic {
                severity: if message.to_ascii_lowercase().contains("warning") {
                    Severity::Warning
                } else {
                    Severity::Error
                },
                file: Some(capture[1].to_owned()),
                line: capture[2].parse().ok(),
                message,
            }
        })
        .collect();
    diagnostics.extend(
        warning
            .captures_iter(log)
            .take(20)
            .map(|capture| Diagnostic {
                severity: Severity::Warning,
                file: None,
                line: None,
                message: capture[1].trim().to_owned(),
            }),
    );
    diagnostics.truncate(50);
    diagnostics
}

async fn propose_ai_edit(request: AiRequest) -> Result<AiProposal> {
    let api_key = env::var("OPENAI_API_KEY").map_err(|_| {
        LatticeError::Message(
            "OPENAI_API_KEY is not configured. Start Lattice from a terminal where the variable is set."
                .into(),
        )
    })?;
    let (_, resolved) = safe_project_path(&request.root, &request.path, true)?;
    if !resolved.is_file() {
        return Err(LatticeError::Message(
            "The active source file no longer exists".into(),
        ));
    }
    if request.source.chars().count() > MAX_AI_SOURCE_CHARS {
        return Err(LatticeError::Message(
            "The active file is too large for a single AI edit. Select a smaller range.".into(),
        ));
    }

    let selection_context = request.selection.as_ref().map(|selection| {
        json!({
            "start_line": selection.start_line,
            "start_column": selection.start_column,
            "end_line": selection.end_line,
            "end_column": selection.end_column,
            "text": selection.text,
        })
    });
    let model = env::var("LATTICE_AI_MODEL").unwrap_or_else(|_| "gpt-5.6-terra".into());
    let body = json!({
        "model": model,
        "store": false,
        "instructions": "You are Lattice's LaTeX editing engine. Return a precise replacement for the selected text, or for the entire source when no selection exists. Preserve valid LaTeX commands and the author's meaning unless asked to change them. Do not use Markdown fences. Never invent citations. The replacement must be directly writable into the .tex file.",
        "input": serde_json::to_string(&json!({
            "request": request.prompt,
            "file": request.path,
            "selection": selection_context,
            "source": request.source,
            "diagnostics": request.diagnostics,
        }))?,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "latex_edit",
                "strict": true,
                "schema": {
                    "type": "object",
                    "properties": {
                        "summary": { "type": "string" },
                        "explanation": { "type": "string" },
                        "replacement": { "type": "string" }
                    },
                    "required": ["summary", "explanation", "replacement"],
                    "additionalProperties": false
                }
            }
        }
    });

    let response: Value = reqwest::Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let output_text = response["output"]
        .as_array()
        .and_then(|items| items.iter().find(|item| item["type"] == "message"))
        .and_then(|message| message["content"].as_array())
        .and_then(|parts| parts.iter().find(|part| part["type"] == "output_text"))
        .and_then(|part| part["text"].as_str())
        .ok_or_else(|| LatticeError::Message("The AI service returned no editable text".into()))?;
    let mut proposal: AiProposal = serde_json::from_str(output_text)?;
    proposal.mode = "live".into();
    Ok(proposal)
}

async fn dispatch(command: &str, args: Value) -> Result<Value> {
    match command {
        "detect_engines" => Ok(serde_json::to_value(detect_engines())?),
        "read_project" => {
            let args: RootArgs = decode_args(args)?;
            Ok(serde_json::to_value(read_project(args.root)?)?)
        }
        "ensure_starter_project" => {
            let args: RootArgs = decode_args(args)?;
            Ok(serde_json::to_value(ensure_starter_project(args.root)?)?)
        }
        "read_project_file" => {
            let args: ReadFileArgs = decode_args(args)?;
            Ok(serde_json::to_value(read_project_file(
                args.root, args.path,
            )?)?)
        }
        "write_project_file" => {
            let args: WriteFileArgs = decode_args(args)?;
            write_project_file(args.root, args.path, args.content)?;
            Ok(Value::Null)
        }
        "compile_project" => {
            let args: CompileArgs = decode_args(args)?;
            Ok(serde_json::to_value(
                compile_project(args.root, args.root_document, args.engine, args.background)
                    .await?,
            )?)
        }
        "render_pdf_page" => {
            let args: RenderPdfPageArgs = decode_args(args)?;
            Ok(serde_json::to_value(render_pdf_page(args).await?)?)
        }
        "forward_search" => {
            let args: ForwardSearchArgs = decode_args(args)?;
            Ok(serde_json::to_value(forward_search(args).await?)?)
        }
        "inverse_search" => {
            let args: InverseSearchArgs = decode_args(args)?;
            Ok(serde_json::to_value(inverse_search(args).await?)?)
        }
        "propose_ai_edit" => {
            let args: AiArgs = decode_args(args)?;
            Ok(serde_json::to_value(propose_ai_edit(args.request).await?)?)
        }
        _ => Err(LatticeError::Message(format!(
            "Unknown backend command: {command}"
        ))),
    }
}

#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut lines = BufReader::new(io::stdin()).lines();
    let mut stdout = io::stdout();
    while let Some(line) = lines.next_line().await? {
        let response = match serde_json::from_str::<RpcRequest>(&line) {
            Ok(request) => match dispatch(&request.command, request.args).await {
                Ok(result) => RpcResponse {
                    id: request.id,
                    result: Some(result),
                    error: None,
                },
                Err(error) => RpcResponse {
                    id: request.id,
                    result: None,
                    error: Some(error.to_string()),
                },
            },
            Err(error) => RpcResponse {
                id: 0,
                result: None,
                error: Some(format!("Invalid request: {error}")),
            },
        };
        stdout
            .write_all(serde_json::to_string(&response)?.as_bytes())
            .await?;
        stdout.write_all(b"\n").await?;
        stdout.flush().await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        env::temp_dir().join(format!("lattice-{label}-{}-{unique}", std::process::id()))
    }

    fn listed(path: &str, kind: &'static str) -> ProjectFile {
        ProjectFile {
            path: path.into(),
            name: Path::new(path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            kind,
        }
    }

    #[test]
    fn parses_file_line_errors() {
        let diagnostics = parse_diagnostics("./main.tex:12: Undefined control sequence.\n");
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].line, Some(12));
        assert!(diagnostics[0].message.contains("Undefined"));
    }

    #[test]
    fn build_response_does_not_embed_rasterized_page_copies() {
        let response = serde_json::to_value(BuildResult {
            success: true,
            duration_ms: 12,
            engine: EngineId::PdfLatex,
            diagnostics: vec![],
            log: String::new(),
            pdf_base64: Some("pdf".into()),
            pdf_version: Some("version-1".into()),
        })
        .unwrap();

        assert_eq!(response["pdfBase64"], "pdf");
        assert_eq!(response["pdfVersion"], "version-1");
        assert!(!response.as_object().unwrap().contains_key("previewPages"));
    }

    #[test]
    fn parses_forward_synctex_coordinates() {
        let position = parse_synctex_forward(
            "SyncTeX result begin\nPage:2\nx:71.5\ny:227.25\nW:468.0\nH:12.75\nSyncTeX result end\n",
        )
        .unwrap();
        assert_eq!(position.page, 2);
        assert_eq!(position.x, 71.5);
        assert_eq!(position.y, 227.25);
        assert_eq!(position.width, 468.0);
        assert_eq!(position.height, 12.75);
    }

    #[test]
    fn parses_inverse_synctex_source_and_normalizes_missing_column() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!(
            "lattice-synctex-test-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::write(root.join("chapters/intro.tex"), "Introduction").unwrap();
        let canonical_root = root.canonicalize().unwrap();
        let output = format!(
            "SyncTeX result begin\nInput:{}\nLine:17\nColumn:-1\nOffset:0\nSyncTeX result end\n",
            root.join("chapters/intro.tex").to_string_lossy()
        );
        let position = parse_synctex_inverse(&output, &canonical_root).unwrap();
        assert_eq!(position.path, "chapters/intro.tex");
        assert_eq!(position.line, 17);
        assert_eq!(position.column, 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_path_traversal_components_before_access() {
        let error = safe_project_path(".", "../secret.tex", true).unwrap_err();
        assert!(error.to_string().contains("relative"));
    }

    #[test]
    fn creates_the_starter_project_without_overwriting_edits() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!(
            "lattice-starter-test-{}-{unique}",
            std::process::id()
        ));

        let project = ensure_starter_project(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(project.root_document, "main.tex");
        assert_eq!(
            fs::read_to_string(root.join("main.tex")).unwrap(),
            STARTER_SOURCE
        );

        fs::write(root.join("main.tex"), "saved edit").unwrap();
        ensure_starter_project(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("main.tex")).unwrap(),
            "saved edit"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn maps_every_engine_to_executable_flag_and_json_id() {
        let cases = [
            (EngineId::PdfLatex, "pdflatex", "-pdf", "pdflatex"),
            (EngineId::XeLatex, "xelatex", "-xelatex", "xelatex"),
            (EngineId::LuaLatex, "lualatex", "-lualatex", "lualatex"),
        ];
        for (engine, executable, flag, json_id) in cases {
            assert_eq!(engine.executable(), executable);
            assert_eq!(engine.latexmk_flag(), flag);
            assert_eq!(serde_json::to_value(engine).unwrap(), json!(json_id));
        }
    }

    #[test]
    fn decodes_valid_arguments_and_reports_invalid_json_shapes() {
        let decoded: ReadFileArgs =
            decode_args(json!({"root": "/tmp", "path": "main.tex"})).unwrap();
        assert_eq!(decoded.root, "/tmp");
        assert_eq!(decoded.path, "main.tex");
        let error = decode_args::<ReadFileArgs>(json!({"root": 7}))
            .err()
            .unwrap();
        assert!(error.to_string().contains("invalid JSON"));
    }

    #[test]
    fn snapshots_supported_files_in_sorted_order_and_skips_generated_content() {
        let root = temp_root("snapshot");
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(root.join("dist")).unwrap();
        fs::write(root.join("main.tex"), "\\documentclass{article}").unwrap();
        fs::write(root.join("chapters/z.tex"), "chapter").unwrap();
        fs::write(root.join("references.BIB"), "@book{x}").unwrap();
        fs::write(root.join("figure.SVG"), "<svg/>").unwrap();
        fs::write(root.join("notes.txt"), "ignored").unwrap();
        fs::write(root.join(".hidden/secret.tex"), "ignored").unwrap();
        fs::write(root.join("node_modules/pkg/file.tex"), "ignored").unwrap();
        fs::write(root.join("dist/file.tex"), "ignored").unwrap();

        let snapshot = snapshot_project(&root).unwrap();
        assert_eq!(snapshot.name, root.file_name().unwrap().to_string_lossy());
        assert_eq!(snapshot.root_document, "main.tex");
        assert_eq!(
            snapshot
                .files
                .iter()
                .map(|file| (&*file.path, file.kind))
                .collect::<Vec<_>>(),
            vec![
                ("chapters/z.tex", "tex"),
                ("figure.SVG", "image"),
                ("main.tex", "tex"),
                ("references.BIB", "bib"),
            ]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn snapshot_requires_a_directory_and_a_tex_document() {
        let root = temp_root("invalid-project");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("references.bib"), "@book{x}").unwrap();
        assert!(snapshot_project(&root)
            .err()
            .unwrap()
            .to_string()
            .contains("No .tex"));
        let file = root.join("not-a-directory");
        fs::write(&file, "text").unwrap();
        assert!(snapshot_project(&file)
            .err()
            .unwrap()
            .to_string()
            .contains("not a directory"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn root_document_prefers_conventional_names_then_documentclass() {
        let root = temp_root("root-detection");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("article.tex"), "\\documentclass{article}").unwrap();
        fs::write(root.join("notes.tex"), "fragment").unwrap();
        let fallback = vec![listed("notes.tex", "tex"), listed("article.tex", "tex")];
        assert_eq!(
            detect_root_document(&root, &fallback).as_deref(),
            Some("article.tex")
        );
        for preferred in ["thesis.tex", "paper.tex", "main.tex"] {
            fs::write(root.join(preferred), "fragment").unwrap();
        }
        let preferred = vec![
            listed("thesis.tex", "tex"),
            listed("paper.tex", "tex"),
            listed("main.tex", "tex"),
        ];
        assert_eq!(
            detect_root_document(&root, &preferred).as_deref(),
            Some("main.tex")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn collection_stops_below_the_depth_limit() {
        let root = temp_root("depth");
        fs::create_dir_all(&root).unwrap();
        let mut directory = root.clone();
        for index in 0..10 {
            directory = directory.join(format!("d{index}"));
            fs::create_dir_all(&directory).unwrap();
            fs::write(directory.join(format!("level{index}.tex")), "fragment").unwrap();
        }
        let mut files = Vec::new();
        collect_project_files(&root, &root, 0, &mut files).unwrap();
        assert!(files.iter().any(|file| file.path.ends_with("level7.tex")));
        assert!(!files.iter().any(|file| file.path.ends_with("level9.tex")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn safe_paths_accept_normal_files_and_reject_absolute_dot_and_missing_parent_paths() {
        let root = temp_root("safe-paths");
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::write(root.join("chapters/one.tex"), "one").unwrap();
        let (_, existing) =
            safe_project_path(&root.to_string_lossy(), "chapters/one.tex", true).unwrap();
        assert_eq!(
            existing,
            root.join("chapters/one.tex").canonicalize().unwrap()
        );
        let (_, new_file) =
            safe_project_path(&root.to_string_lossy(), "chapters/two.tex", false).unwrap();
        assert_eq!(
            new_file,
            root.canonicalize().unwrap().join("chapters/two.tex")
        );
        for invalid in ["/etc/passwd", "./main.tex", "chapters/../one.tex", ""] {
            assert!(
                safe_project_path(&root.to_string_lossy(), invalid, false).is_err(),
                "{invalid}"
            );
        }
        assert!(safe_project_path(&root.to_string_lossy(), "missing/file.tex", false).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn safe_paths_reject_symlinks_that_escape_the_project() {
        use std::os::unix::fs::symlink;
        let root = temp_root("symlink-root");
        let outside = temp_root("symlink-outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.tex"), "secret").unwrap();
        symlink(outside.join("secret.tex"), root.join("linked.tex")).unwrap();
        let error = safe_project_path(&root.to_string_lossy(), "linked.tex", true).unwrap_err();
        assert!(error.to_string().contains("outside"));
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn reads_and_writes_each_supported_source_extension_case_insensitively() {
        let root = temp_root("read-write");
        fs::create_dir_all(&root).unwrap();
        for extension in ["tex", "BIB", "sty", "CLS"] {
            let path = format!("file.{extension}");
            write_project_file(
                root.to_string_lossy().into_owned(),
                path.clone(),
                format!("content-{extension}"),
            )
            .unwrap();
            assert_eq!(
                read_project_file(root.to_string_lossy().into_owned(), path).unwrap(),
                format!("content-{extension}")
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_unsupported_or_oversized_writes_and_oversized_reads() {
        let root = temp_root("limits");
        fs::create_dir_all(&root).unwrap();
        assert!(write_project_file(
            root.to_string_lossy().into_owned(),
            "image.png".into(),
            "data".into()
        )
        .unwrap_err()
        .to_string()
        .contains("only writes"));
        let oversized = "x".repeat(MAX_EDITABLE_FILE_BYTES as usize + 1);
        assert!(write_project_file(
            root.to_string_lossy().into_owned(),
            "large.tex".into(),
            oversized
        )
        .unwrap_err()
        .to_string()
        .contains("too large"));
        let large_path = root.join("existing.tex");
        let file = fs::File::create(&large_path).unwrap();
        file.set_len(MAX_EDITABLE_FILE_BYTES + 1).unwrap();
        assert!(
            read_project_file(root.to_string_lossy().into_owned(), "existing.tex".into())
                .unwrap_err()
                .to_string()
                .contains("too large")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn extracts_trimmed_synctex_values_and_uses_default_box_dimensions() {
        assert_eq!(synctex_value("Page: 3 \n", "Page"), Some("3"));
        assert_eq!(synctex_value("Page 3\n", "Page"), None);
        let position = parse_synctex_forward("Page:1\nx:2\ny:3").unwrap();
        assert_eq!(position.width, 8.0);
        assert_eq!(position.height, 12.0);
    }

    #[test]
    fn rejects_missing_or_invalid_forward_synctex_fields() {
        for (output, message) in [
            ("x:1\ny:2", "no matching preview"),
            ("Page:nope\nx:1\ny:2", "invalid page"),
            ("Page:1\ny:2", "no x coordinate"),
            ("Page:1\nx:nope\ny:2", "invalid x coordinate"),
        ] {
            assert!(
                parse_synctex_forward(output)
                    .unwrap_err()
                    .to_string()
                    .contains(message),
                "{output}"
            );
        }
    }

    #[test]
    fn inverse_synctex_accepts_relative_paths_and_positive_columns() {
        let root = temp_root("inverse-relative");
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::write(root.join("chapters/intro.tex"), "text").unwrap();
        let canonical = root.canonicalize().unwrap();
        let position =
            parse_synctex_inverse("Input:chapters/intro.tex\nLine:4\nColumn:7", &canonical)
                .unwrap();
        assert_eq!(position.path, "chapters/intro.tex");
        assert_eq!(position.line, 4);
        assert_eq!(position.column, 7);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn inverse_synctex_rejects_missing_paths_invalid_lines_and_external_sources() {
        let root = temp_root("inverse-errors");
        let outside = temp_root("inverse-external");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(root.join("main.tex"), "text").unwrap();
        fs::write(outside.join("secret.tex"), "text").unwrap();
        let canonical = root.canonicalize().unwrap();
        assert!(parse_synctex_inverse("Line:1", &canonical)
            .unwrap_err()
            .to_string()
            .contains("no matching source"));
        assert!(parse_synctex_inverse("Input:main.tex\nLine:0", &canonical)
            .unwrap_err()
            .to_string()
            .contains("invalid source line"));
        let external = format!("Input:{}\nLine:1", outside.join("secret.tex").display());
        assert!(parse_synctex_inverse(&external, &canonical)
            .unwrap_err()
            .to_string()
            .contains("outside"));
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn computes_the_synctex_pdf_path_from_the_root_document_stem() {
        assert_eq!(
            synctex_output_path(Path::new("/paper"), Path::new("/paper/chapters/main.tex")),
            Path::new("/paper/.lattice/build/main.pdf"),
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn renders_one_current_pdf_page_as_svg_and_rejects_stale_or_invalid_requests() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_root("pdf-page");
        fs::create_dir_all(root.join(".lattice/build")).unwrap();
        fs::write(root.join("main.tex"), "\\documentclass{article}").unwrap();
        let pdf = root.join(".lattice/build/main.pdf");
        fs::write(&pdf, "pdf-one").unwrap();
        let version = pdf_file_version(&pdf).unwrap();
        let renderer = root.join("fake-pdftocairo");
        fs::write(
            &renderer,
            "#!/bin/sh\nprintf '<?xml version=\"1.0\"?><svg data-page=\"%s\"></svg>' \"$2\"\n",
        )
        .unwrap();
        let mut permissions = renderer.metadata().unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&renderer, permissions).unwrap();
        let args = |version: String, page| RenderPdfPageArgs {
            root: root.to_string_lossy().into_owned(),
            root_document: "main.tex".into(),
            pdf_version: version,
            page,
        };

        let image = render_pdf_page_with(renderer.to_str().unwrap(), args(version.clone(), 2))
            .await
            .unwrap();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(image.svg_base64)
            .unwrap();
        assert!(String::from_utf8(decoded)
            .unwrap()
            .contains("data-page=\"2\""));

        let invalid_page =
            render_pdf_page_with(renderer.to_str().unwrap(), args(version.clone(), 0))
                .await
                .unwrap_err();
        assert!(invalid_page.to_string().contains("Invalid PDF page"));

        fs::write(&pdf, "a different pdf length").unwrap();
        let stale = render_pdf_page_with(renderer.to_str().unwrap(), args(version, 1))
            .await
            .unwrap_err();
        assert!(stale.to_string().contains("stale"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_failed_and_malformed_pdf_page_renderer_output() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_root("pdf-page-errors");
        fs::create_dir_all(root.join(".lattice/build")).unwrap();
        fs::write(root.join("main.tex"), "source").unwrap();
        let pdf = root.join(".lattice/build/main.pdf");
        fs::write(&pdf, "pdf").unwrap();
        let request = || RenderPdfPageArgs {
            root: root.to_string_lossy().into_owned(),
            root_document: "main.tex".into(),
            pdf_version: pdf_file_version(&pdf).unwrap(),
            page: 1,
        };
        let renderer = root.join("fake-pdftocairo");
        let make_executable = |source: &str| {
            fs::write(&renderer, source).unwrap();
            let mut permissions = renderer.metadata().unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&renderer, permissions).unwrap();
        };

        make_executable("#!/bin/sh\nprintf 'renderer broke' >&2\nexit 7\n");
        let failed = render_pdf_page_with(renderer.to_str().unwrap(), request())
            .await
            .unwrap_err();
        assert!(failed.to_string().contains("renderer broke"));

        make_executable("#!/bin/sh\nprintf 'not an svg'\n");
        let malformed = render_pdf_page_with(renderer.to_str().unwrap(), request())
            .await
            .unwrap_err();
        assert!(malformed.to_string().contains("invalid page image"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn parses_warning_variants_severities_and_caps_diagnostics() {
        let log = "main.tex:2: warning: mild\nstyle.sty:3: Fatal problem\nLaTeX Warning: Citation missing\nPackage hyperref Warning: Link issue\n";
        let diagnostics = parse_diagnostics(log);
        assert_eq!(diagnostics.len(), 4);
        assert!(matches!(diagnostics[0].severity, Severity::Warning));
        assert!(matches!(diagnostics[1].severity, Severity::Error));
        assert!(diagnostics[2].file.is_none());
        let many = (0..80)
            .map(|index| format!("f.tex:{index}: error\n"))
            .collect::<String>();
        assert_eq!(parse_diagnostics(&many).len(), 50);
    }

    #[tokio::test]
    async fn inverse_search_rejects_every_invalid_preview_coordinate_shape() {
        for (page, x, y) in [
            (0, 1.0, 1.0),
            (1, -1.0, 1.0),
            (1, 1.0, -1.0),
            (1, f64::NAN, 1.0),
            (1, 1.0, f64::INFINITY),
        ] {
            let error = inverse_search(InverseSearchArgs {
                root: "ignored".into(),
                root_document: "main.tex".into(),
                page,
                x,
                y,
            })
            .await
            .unwrap_err();
            assert!(error.to_string().contains("Invalid preview position"));
        }
    }

    #[tokio::test]
    async fn synctex_navigation_requires_a_built_pdf_before_running_the_tool() {
        let root = temp_root("missing-pdf");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("main.tex"), "text").unwrap();
        let root_string = root.to_string_lossy().into_owned();
        let forward = forward_search(ForwardSearchArgs {
            root: root_string.clone(),
            root_document: "main.tex".into(),
            path: "main.tex".into(),
            line: 0,
            column: 0,
        })
        .await
        .unwrap_err();
        assert!(forward.to_string().contains("Build the document"));
        let inverse = inverse_search(InverseSearchArgs {
            root: root_string,
            root_document: "main.tex".into(),
            page: 1,
            x: 0.0,
            y: 0.0,
        })
        .await
        .unwrap_err();
        assert!(inverse.to_string().contains("Build the document"));
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn dispatch_rejects_unknown_commands_and_bad_argument_shapes() {
        assert!(dispatch("missing", Value::Null)
            .await
            .unwrap_err()
            .to_string()
            .contains("Unknown backend command"));
        assert!(dispatch("read_project", json!({"root": 4}))
            .await
            .unwrap_err()
            .to_string()
            .contains("invalid JSON"));
    }

    #[tokio::test]
    async fn dispatch_round_trips_project_reads_and_writes() {
        let root = temp_root("dispatch");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("main.tex"), "old").unwrap();
        let root_string = root.to_string_lossy().into_owned();
        let result = dispatch(
            "write_project_file",
            json!({"root": root_string, "path": "main.tex", "content": "new"}),
        )
        .await
        .unwrap();
        assert_eq!(result, Value::Null);
        let content = dispatch(
            "read_project_file",
            json!({"root": root.to_string_lossy(), "path": "main.tex"}),
        )
        .await
        .unwrap();
        assert_eq!(content, json!("new"));
        let project = dispatch("read_project", json!({"root": root.to_string_lossy()}))
            .await
            .unwrap();
        assert_eq!(project["rootDocument"], "main.tex");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rpc_request_defaults_args_and_response_omits_absent_fields() {
        let request: RpcRequest =
            serde_json::from_value(json!({"id": 9, "command": "detect_engines"})).unwrap();
        assert_eq!(request.id, 9);
        assert_eq!(request.command, "detect_engines");
        assert_eq!(request.args, Value::Null);
        let success = serde_json::to_value(RpcResponse {
            id: 9,
            result: Some(json!([])),
            error: None,
        })
        .unwrap();
        assert!(success.get("error").is_none());
        let failure = serde_json::to_value(RpcResponse {
            id: 9,
            result: None,
            error: Some("bad".into()),
        })
        .unwrap();
        assert!(failure.get("result").is_none());
    }
}
