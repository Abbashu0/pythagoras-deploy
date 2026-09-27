import type { ASTNode } from '@ronradtke/react-native-markdown-display';

export function stabilizeNodeKey(node: ASTNode, prefix: string, path: readonly number[]): ASTNode {
  return {
    ...node,
    key: `${prefix}:${path.join('.')}:${node.type}`,
    children: node.children.map((child, index) => stabilizeNodeKey(child, prefix, [...path, index])),
  };
}
