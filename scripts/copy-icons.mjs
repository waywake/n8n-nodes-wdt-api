import { mkdir, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';

const roots = ['nodes', 'credentials'];
const iconExtensions = new Set(['.png', '.svg']);

async function copyIcon(sourcePath, root) {
	const destinationPath = join('dist', root, relative(root, sourcePath));

	await mkdir(dirname(destinationPath), { recursive: true });
	await Bun.write(destinationPath, Bun.file(sourcePath));

	return destinationPath;
}

async function collectIcons(root, directory = root) {
	const entries = await readdir(directory, { withFileTypes: true });
	const icons = [];

	for (const entry of entries) {
		const sourcePath = join(directory, entry.name);

		if (entry.isDirectory()) {
			icons.push(...(await collectIcons(root, sourcePath)));
			continue;
		}

		if (entry.isFile() && iconExtensions.has(extname(entry.name).toLowerCase())) {
			icons.push(sourcePath);
		}
	}

	return icons;
}

let copied = 0;

for (const root of roots) {
	const icons = await collectIcons(root);

	for (const icon of icons) {
		await copyIcon(icon, root);
		copied += 1;
	}
}

console.log(`copied ${copied} icon${copied === 1 ? '' : 's'} to dist`);
