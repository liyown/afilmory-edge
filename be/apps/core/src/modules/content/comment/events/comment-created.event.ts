export class CommentCreatedEvent {
  constructor(
    public readonly commentId: string,
    public readonly photoId: string,
    public readonly userId: string,
    public readonly parentId: string | null,
    public readonly content: string,
    public readonly createdAt: string,
  ) {}
}
