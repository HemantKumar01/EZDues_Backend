const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const fs = require("fs");
const csvParser = require("csv-parser");
const jwt = require("jsonwebtoken");
const config = require("../config.json");

const prisma = new PrismaClient().$extends({
    query: {
        admin: {
            $allOperations({ operation, args, query }) {
                if (
                    ["create", "update"].includes(operation) &&
                    args.data["pswdAdmin"]
                ) {
                    args.data["pswdAdmin"] = bcrypt.hashSync(
                        args.data["pswdAdmin"],
                        config.saltRounds
                    );
                }
                return query(args);
            },
        },
    },
});

const BTechDepartments = [
    "Hostel",
    "Sports",
    "TPC",
    "Academic section",
    "Admin section",
    "Accounts section",
    "Computer Center",
    "Civil Workshop",
    "Electrical Workshop",
    "Mechanical Workshop",
];
const otherDepartments = [
    "Hostel",
    "Sports",
    "TPC",
    "Academic section",
    "Admin section",
    "Accounts section",
    "Computer Center",
];

async function createAdmin(req, res) {
    if (!req.auth.isSuperAdmin) {
        return res.status(403).json({
            error: "Only super admins are allowed to create admin",
        });
    }

    try {
        const { username, password } = req.body;

        if (username === undefined || password === undefined) {
            return res.status(422).json("Enter username and password");
        }

        //creating admin

        const newAdmin = await prisma.Admin.create({
            data: {
                username,
                pswdAdmin: bcrypt.hashSync(password, config.saltRounds),
                isSuperAdmin: false, // the admin created now will not be superadmin
                // we will have only one superadmin
            },
        });

        res.status(201).json(newAdmin);
    } catch (error) {
        console.error("Error creating the admin", error);
        res.sendStatus(500);
    }
}

async function addDepartments(req, res) {
    try {
        const { deptName, username, password } = req.body;

        // if the department with the given name already exists, then error
        const existingDepartment = await prisma.Department.findFirst({
            where: {
                deptId: deptName,
            },
        });

        if (existingDepartment) {
            return res
                .status(400)
                .json({ error: "Department with this name already exists." });
        }

        // Create the new department
        const newDepartment = await prisma.Department.create({
            data: {
                deptId: deptName,
                username,
                pswdDept: bcrypt.hashSync(password, config.saltRounds),
            },
        });

        res.status(201).json(newDepartment);
    } catch (error) {
        console.error("Error adding department:", error);
        res.sendStatus(500);
    }
}

async function bulkRegistration(req, res) {
    // console.log(req.files.file.tempFilePath);
    try {
        // Check if a CSV file was uploaded
        if (!req.files.file) {
            return res.status(400).json({ error: "No CSV file uploaded" });
        }

        //I initialised and array to store the student data
        // and then to push it to db

        const students = [];
        // Read the uploaded CSV file
        fs.createReadStream(req.files.file.tempFilePath)
            .pipe(csvParser())
            .on("data", (row) => {
                console.log(row.email);
                // Process each row of the CSV file
                students.push({
                    rollNumber: row.rollNumber,
                    name: row.name,
                    email: row.email,
                    branch: row.branch,
                    batch: parseInt(row.batch), // converting batch to an integer cauz year
                    //role: row.role || "BTech" Default role to BTech if not provided
                    role: row.role ? row.role : "BTech",
                });
            })
            .on("end", async () => {
                // Create multiple student records in the database
                const createdStudents = await prisma.Student.createMany({
                    data: students,
                });

                // Remove the uploaded CSV file
                fs.unlinkSync(req.files.file.tempFilePath);

                res.status(201).json(createdStudents);
            });
    } catch (error) {
        console.error("Error in bulk registration:", error);
        res.sendStatus(500);
    }
}

async function registerStudents(req, res) {
    try {
        const { rollNumber, name, email, branch, batch, role } = req.body;
        // Create the student record
        const createdStudent = await prisma.Student.create({
            data: {
                rollNumber,
                name,
                email,
                branch,
                batch,
                role,
            },
        });
        res.status(201).json(createdStudent);
    } catch (error) {
        console.error("Error registering students:", error);
        res.sendStatus(500);
    }
}
async function addFinesBulk(req, res) {
    try {
        const { fines } = req.body;

        const createdFines = await prisma.Fines.createMany({
            data: fines.map((fine) => ({
                studentRollNumber: fine.studentRollNumber,
                amount: fine.amount,
                studentEmail: fine.studentEmail,
                departmentDeptId: fine.departmentDeptId,
                dateOfCreation: new Date(),
                deadline: fine.deadline,
                reason: fine.reason,
                damageProof: fine.damageProof,
                status: "Outstanding", // set the default status to outstanding as said
            })),
        });

        res.status(201).json(createdFines);
    } catch (error) {
        console.error("Error adding fine in bulk:", error);
        res.sendStatus(500);
    }
}

async function makeFinalYearEligible(req, res) {
    try {
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth();

        //what should be finalYearBatchYear? as session starts in july of batch-1 year uptil june of batch year

        let finalYearBatchYear;
        if (currentMonth >= 6) {
            // After July of current year, final year students are from batch year x+1
            finalYearBatchYear = currentYear + 1;
        } else {
            // Before July of current year, final year students are from batch year x
            finalYearBatchYear = currentYear;
        }

        const finalYearStudents = await prisma.Student.findMany({
            where: {
                batch: finalYearBatchYear,
            },
        });
        await prisma.Student.updateMany({
            where: {
                rollNumber: {
                    in: finalYearStudents.map((student) => student.rollNumber),
                },
            },
            data: {
                canRequest: true,
            },
        });
        res.status(200).json({
            message: "FINAL YEAR STUDENTS ARE MADE ELIGIBLE FINALLY",
        });
    } catch (error) {
        console.error("Error making final year students eligible:", error);
        res.sendStatus(500);
    }
}
async function getDepartments(req, res) {
    try {
        const departments = await prisma.Department.findMany();
        res.status(200).json(departments);
    } catch (error) {
        console.error("Error showing departments", error);
        res.sendStatus(500);
    }
}

async function autoApprove(req, res) {
    try {
        const students = await prisma.Student.findMany();

        // need to create requests for each combinations of students and departments

        const requests = [];
        students.forEach((student) => {
            const departments =
                student.role === "BTech" ? BTechDepartments : otherDepartments;
            switch (student.branch) {
                case "Electrical":
                    departments.push("Electrical Workshop");
                    break;
                case "Civil":
                    departments.push("Civil Workshop");
                    break;
                case "Mechanical":
                    departments.push("Mechanical Workshop");
                    break;

                default:
                    break;
            }
            departments.forEach((department) => {
                requests.push({
                    studentRollNumber: student.rollNumber,
                    studentEmail: student.email,
                    departmentDeptId: department,
                    dateOfRequest: new Date(),
                    dateOfApproval: new Date(0),
                    isApproved: false,
                });
            });
        });
        console.log(requests);
        await prisma.Requests.createMany({
            data: requests,
        });

        res.status(200).json({
            message:
                "Request for Auto Approval has been initiated successfully!",
        });
    } catch (error) {
        console.error("Error initiating auto approval:", error);
        res.sendStatus(500);
    }
}

async function login(req, res) {
    const { username, password } = req.body;
    if (username === undefined || password === undefined) {
        return res.status(422).json("Enter username and password");
    }

    const admin = await prisma.Admin.findUnique({
        where: {
            username,
        },
    });
    if (!admin) {
        return res.status(422).json("No such username found");
    }

    await bcrypt.compare(password, admin.pswdAdmin, (err, result) => {
        if (err) {
            console.log(err);
            res.sendStatus(500);
        } else if (result) {
            const token = jwt.sign(
                { isSuperAdmin: admin.isSuperAdmin, type: "admin" },
                config.secret,
                {
                    expiresIn: "24h",
                }
            );
            res.cookie("idtoken", token, { httpOnly: true, sameSite: "Lax" });
            res.sendStatus(200);
        } else {
            res.status(401).json("Incorrect password");
        }
    });
}
async function getStudents(req, res) {
    try {
        const students = await prisma.Student.findMany();
        res.status(200).json(students);
    } catch (error) {
        console.error("Error showing departments", error);
        res.sendStatus(500);
    }
}

// other admin-related controller functions...

module.exports = {
    createAdmin,
    addDepartments,
    bulkRegistration,
    registerStudents,
    addFinesBulk,
    makeFinalYearEligible,
    autoApprove,
    login,
    getDepartments,
    getStudents,
    // export other admin-related controller functions...
};
/* vi: set et sw=4: */
