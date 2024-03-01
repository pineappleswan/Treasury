import { Model, InferAttributes, InferCreationAttributes, CreationOptional, ForeignKey } from "sequelize";

class UnclaimedUser extends Model<InferAttributes<UnclaimedUser>, InferCreationAttributes<UnclaimedUser>> {
	declare claimCode: string;
	declare storageQuota: number;
	declare passwordPublicSalt: string;
	declare passwordPrivateSalt: string;
	declare masterKeySalt: string;
}

class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
	declare id: CreationOptional<number>;
	declare username: string;
	declare passwordPublicSalt: string;
	declare passwordPrivateSalt: string;
	declare masterKeySalt: string;
	declare passwordHash: string;
	declare storageQuota: number;
	declare claimCode: string;
}

class UserFile extends Model<InferAttributes<UserFile>, InferCreationAttributes<UserFile>> {
	declare userId: ForeignKey<number>;
	declare handle: string;
	declare parentHandle: string; // The parent file/folder (this is how directories are made)
	declare encryptedFileNameWithNonce: Buffer // Stored as a blob
}

export {
	UnclaimedUser,
	User,
	UserFile
};
