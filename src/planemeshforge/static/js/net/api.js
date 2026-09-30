// Plain HTTP calls to the Flask backend.

export async function uploadMesh(file) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/load", { method: "POST", body: formData });
    if (!response.ok) {
        throw new Error(await response.text());
    }
    return response;
}

export async function fetchElementTypes() {
    const response = await fetch("/element-types");
    return response.json();
}

export async function exportMesh() {
    const response = await fetch("/export");
    if (!response.ok) {
        throw new Error(await response.text());
    }
    return response.blob();
}
