"use client"

import type { BlogPostData, EditorState, RevisionSummary } from "@/features/cms"

import {
  ContentShell,
  type CmsPermissions,
  type EditorLabels,
} from "./content-shell"
import type { Option } from "./labels"
import { PostBuilder } from "./post-builder"

export function PostEditor({
  postId,
  state,
  revisions,
  permissions,
  labels,
  authors,
  categories,
  tags,
}: {
  postId: string
  state: EditorState<BlogPostData>
  revisions: RevisionSummary[]
  permissions: CmsPermissions
  labels: EditorLabels
  authors: Option[]
  categories: Option[]
  tags: Option[]
}) {
  return (
    <ContentShell
      target={{ type: "blog_post", id: postId }}
      state={state}
      revisions={revisions}
      permissions={permissions}
      labels={labels}
      noun="story"
      editor={(context) => (
        <PostBuilder
          postId={postId}
          state={state}
          context={context}
          authors={authors}
          categories={categories}
          tags={tags}
        />
      )}
    />
  )
}
