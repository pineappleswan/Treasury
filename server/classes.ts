import { Model, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";

class UnclaimedUser extends Model<InferAttributes<UnclaimedUser>, InferCreationAttributes<UnclaimedUser>> {
	declare claimCode: string;
	declare storageQuota: number;
	declare passwordPublicSalt: string;
	declare passwordPrivateSalt: string;
	declare masterKeySalt: string;
}

class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
	declare username: string;
	declare passwordPublicSalt: string;
	declare passwordPrivateSalt: string;
	declare masterKeySalt: string;
	declare passwordHash: string;
	declare storageQuota: number;
	declare claimCode: string;
}

class UserFilesystem extends Model<InferAttributes<UserFilesystem>, InferCreationAttributes<UserFilesystem>> {
	declare handle: string;
	declare parentHandle: string; // The parent file/folder (this is how directories are made)
	declare encryptedFileNameWithNonce: Buffer // Stored as a blob
}

export {
	UnclaimedUser,
	User,
	UserFilesystem
};
